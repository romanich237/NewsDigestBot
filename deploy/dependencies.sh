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

system_runtime_ready() {
  [ -x /usr/bin/node ] && [ -x /usr/bin/npm ] &&
    /usr/bin/node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)" &&
    /usr/bin/npm --version >/dev/null 2>&1
}

install_node_repository() (
  set -euo pipefail
  local_dir="$(mktemp -d)"
  trap 'for file in "$local_dir/key" "$local_dir/key.gpg"; do if [ -f "$file" ]; then unlink "$file"; fi; done; rmdir "$local_dir"' EXIT
  curl --fail --silent --show-error --location --retry 3 --max-time 60 \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$local_dir/key"
  gpg --batch --yes --dearmor --output "$local_dir/key.gpg" "$local_dir/key"
  install -d -m 755 /usr/share/keyrings /etc/apt/sources.list.d
  install -m 644 "$local_dir/key.gpg" /usr/share/keyrings/nodesource.gpg
  if [ -f /etc/apt/sources.list.d/nodesource.list ]; then unlink /etc/apt/sources.list.d/nodesource.list; fi
  cat > /etc/apt/sources.list.d/nodesource.sources <<REPO
Types: deb
URIs: https://deb.nodesource.com/node_22.x
Suites: nodistro
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /usr/share/keyrings/nodesource.gpg
REPO
  apt-get update
  # The NodeSource nodejs package includes npm; a separate distro npm package is unnecessary.
  apt-get install -y --reinstall nodejs
)

install_dependencies() {
  if [ "$(id -u)" -ne 0 ]; then echo "Запусти установщик от root или через sudo" >&2; return 1; fi
  detect_platform "${1:-/etc/os-release}" || return 1
  local arch
  arch="$(dpkg --print-architecture)"
  case "$arch" in amd64|arm64) ;; *) echo "Поддерживаются amd64 и arm64; обнаружено: $arch" >&2; return 1 ;; esac
  echo "Устанавливаю Git, curl, сертификаты, Python и инструменты сборки SQLite…"
  apt-get update || return 1
  apt-get install -y ca-certificates curl gnupg git python3 build-essential pkg-config tar xz-utils util-linux passwd systemd || return 1
  if system_runtime_ready; then
    echo "Подходящие системные Node.js и npm уже установлены."
  else
    echo "Устанавливаю Node.js 22 LTS и npm из NodeSource…"
    install_node_repository || return 1
  fi
  if ! system_runtime_ready; then echo "Не удалось установить системные Node.js 20.19+ и npm. Проверь apt и возможные конфликты пакетов." >&2; return 1; fi
  echo "Node.js: $(/usr/bin/node --version); npm: $(/usr/bin/npm --version)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then install_dependencies; fi
