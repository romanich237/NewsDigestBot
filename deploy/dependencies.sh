#!/usr/bin/env bash
# Shared dependency setup for Ubuntu and Debian. Safe to source from install.sh.
set -euo pipefail

detect_platform() {
  local release_file="${1:-/etc/os-release}"
  if [ ! -r "$release_file" ]; then echo "Не найден /etc/os-release" >&2; return 1; fi
  local ID="" VERSION_ID="" PRETTY_NAME=""
  . "$release_file"
  local major="${VERSION_ID%%.*}"
  if ! [[ "$major" =~ ^[0-9]+$ ]]; then echo "Не удалось определить версию ОС" >&2; return 1; fi
  case "$ID" in
    ubuntu) if [ "$major" -lt 22 ]; then echo "Нужна Ubuntu 22.04 или новее" >&2; return 1; fi ;;
    debian) if [ "$major" -lt 12 ]; then echo "Нужен Debian 12 или новее" >&2; return 1; fi ;;
    *) echo "Поддерживаются Ubuntu 22.04+ и Debian 12+; обнаружено: ${PRETTY_NAME:-$ID}" >&2; return 1 ;;
  esac
  echo "ОС: ${PRETTY_NAME:-$ID $VERSION_ID}"
}

apt_run() {
  LC_ALL=C DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=120 -o Acquire::Retries=3 \
    -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 \
    -o APT::Get::AutomaticRemove=false "$@"
}
package_installed() {
  local state
  state="$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null)" || return 1
  [[ "$state" == *' installed' || "$state" == *' unpacked' || "$state" == *' half-configured' || "$state" == *' half-installed' ]]
}
node_package_ready() {
  local status version
  status="$(dpkg-query -W -f='${Status}' nodejs 2>/dev/null)" || return 1
  version="$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null)" || return 1
  [ "$status" = 'install ok installed' ] && dpkg --compare-versions "$version" ge 20.19.0
}
system_runtime_ready() {
  node_package_ready &&
  [ -x /usr/bin/node ] && [ -x /usr/bin/npm ] &&
    /usr/bin/node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)" &&
    /usr/bin/npm --version >/dev/null 2>&1
}
# Never accept unrelated package removals just to make the Node.js migration succeed.
check_removal_plan() {
  local plan="$1" line package
  while IFS= read -r line; do
    if [[ "$line" == Remv\ * ]]; then
      read -r _ package _ <<< "$line"
      package="${package%%:*}"
      case "$package" in
        nodejs|nodejs-doc|nodejs-dev|npm|libnode-dev|node-*|libnode[0-9]*) ;;
        *) echo "APT хочет удалить посторонний пакет $package. Автоматическая установка остановлена." >&2; return 1 ;;
      esac
    fi
  done <<< "$plan"
}
safe_apt_change() {
  local plan
  plan="$(apt_run --simulate "$@" 2>&1)" || { echo "$plan" >&2; return 1; }
  check_removal_plan "$plan" || return 1
  apt_run -y "$@" || return 1
}
remove_legacy_node_packages() {
  if system_runtime_ready; then return; fi
  local packages=() package
  for package in libnode-dev nodejs-doc npm; do
    if package_installed "$package"; then packages+=("$package"); fi
  done
  if [ "${#packages[@]}" -gt 0 ]; then
    echo "Убираю конфликтующие пакеты старого Node.js: ${packages[*]}"
    # One APT transaction also handles the partially unpacked state after a failed migration.
    safe_apt_change --fix-broken remove "${packages[@]}" || return 1
  fi
}
repair_package_state() {
  local audit
  audit="$(dpkg --audit 2>&1)" || return 1
  if [ -n "$audit" ]; then
    echo "Восстанавливаю незавершённую установку пакетов…"
    if ! dpkg --configure -a; then echo "Есть незавершённые зависимости; исправляю через APT."; fi
    safe_apt_change --fix-broken install || return 1
    audit="$(dpkg --audit 2>&1)" || return 1
    if [ -n "$audit" ]; then echo "$audit" >&2; echo "Состояние dpkg требует ручной проверки." >&2; return 1; fi
  fi
}
install_node_repository() (
  set -euo pipefail
  local_dir="$(mktemp -d)" || exit 1
  trap 'for file in "$local_dir/key" "$local_dir/key.gpg"; do if [ -f "$file" ]; then unlink "$file"; fi; done; rmdir "$local_dir"' EXIT
  curl --fail --silent --show-error --location --retry 3 --max-time 60 \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$local_dir/key" || exit 1
  gpg --batch --yes --dearmor --output "$local_dir/key.gpg" "$local_dir/key" || exit 1
  install -d -m 755 /usr/share/keyrings /etc/apt/sources.list.d || exit 1
  install -m 644 "$local_dir/key.gpg" /usr/share/keyrings/nodesource.gpg || exit 1
  if [ -f /etc/apt/sources.list.d/nodesource.list ]; then unlink /etc/apt/sources.list.d/nodesource.list || exit 1; fi
  cat > /etc/apt/sources.list.d/nodesource.sources <<REPO
Types: deb
URIs: https://deb.nodesource.com/node_22.x
Suites: nodistro
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /usr/share/keyrings/nodesource.gpg
REPO
  apt_run update || exit 1
  # npm is included in NodeSource's nodejs package. Do not install distro npm alongside it.
  safe_apt_change --reinstall install nodejs || exit 1
)

install_dependencies() {
  if [ "$(id -u)" -ne 0 ]; then echo "Запусти установщик от root или через sudo" >&2; return 1; fi
  detect_platform "${1:-/etc/os-release}" || return 1
  local arch package missing=()
  arch="$(dpkg --print-architecture)"
  case "$arch" in amd64|arm64) ;; *) echo "Поддерживаются amd64 и arm64; обнаружено: $arch" >&2; return 1 ;; esac
  echo "[1/3] Проверяю APT и старые пакеты Node.js…"
  apt_run update || return 1
  remove_legacy_node_packages || return 1
  repair_package_state || return 1
  echo "[2/3] Проверяю инструменты сборки и системные зависимости…"
  for package in ca-certificates curl gnupg git python3 build-essential pkg-config tar xz-utils util-linux passwd systemd; do
    if ! package_installed "$package"; then missing+=("$package"); fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    safe_apt_change install "${missing[@]}" || return 1
  else
    echo "Все системные зависимости уже установлены."
  fi
  echo "[3/3] Проверяю Node.js и npm…"
  if system_runtime_ready; then
    echo "Подходящие системные Node.js и npm уже установлены."
  else
    echo "Устанавливаю Node.js 22 LTS с npm из NodeSource…"
    install_node_repository || return 1
  fi
  if ! system_runtime_ready; then echo "Не удалось установить системные Node.js 20.19+ и npm. Проверь сообщения APT выше." >&2; return 1; fi
  echo "Node.js: $(/usr/bin/node --version); npm: $(/usr/bin/npm --version)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then install_dependencies; fi
