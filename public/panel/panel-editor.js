"use strict";

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "INS",
  "S",
  "STRIKE",
  "DEL",
  "A",
  "CODE",
  "PRE",
  "BLOCKQUOTE",
  "TG-SPOILER",
  "BR",
]);

function safePreview(html) {
  const parsed = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  for (const element of [...parsed.body.querySelectorAll("*")]) {
    if (element.tagName === "DIV") continue;
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (
        element.tagName !== "A" ||
        attribute.name !== "href" ||
        !/^(https?:\/\/|tg:\/\/|mailto:)/i.test(attribute.value)
      )
        element.removeAttribute(attribute.name);
    }
  }
  return parsed.body.firstElementChild?.innerHTML || "";
}

function wrapSelection(textarea, before, after = before) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || "текст";
  textarea.setRangeText(`${before}${selected}${after}`, start, end, "select");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

function createHtmlEditor(value, onChange) {
  const root = document.createElement("div");
  root.className = "html-editor";
  const toolbar = document.createElement("div");
  toolbar.className = "editor-toolbar";
  toolbar.setAttribute("aria-label", "Форматирование подписи");
  const textarea = document.createElement("textarea");
  textarea.value = value || "";
  textarea.maxLength = 800;
  textarea.setAttribute("aria-label", "HTML подписи");
  const preview = document.createElement("div");
  preview.className = "editor-preview";

  const commands = [
    ["B", "<b>", "</b>", "Жирный"],
    ["I", "<i>", "</i>", "Курсив"],
    ["U", "<u>", "</u>", "Подчёркнутый"],
    ["S", "<s>", "</s>", "Зачёркнутый"],
    ["</>", "<code>", "</code>", "Код"],
  ];
  for (const [label, before, after, title] of commands) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.onclick = () => wrapSelection(textarea, before, after);
    toolbar.append(button);
  }
  const link = document.createElement("button");
  link.type = "button";
  link.textContent = "Ссылка";
  link.onclick = () => {
    const href = window.prompt("Адрес ссылки, начиная с https:// или tg://");
    if (href && /^(https?:\/\/|tg:\/\/|mailto:)/i.test(href))
      wrapSelection(
        textarea,
        `<a href="${href.replace(/["<>]/g, "")}">`,
        "</a>",
      );
  };
  toolbar.append(link);

  const update = () => {
    preview.innerHTML =
      safePreview(textarea.value) || "<span>Предпросмотр подписи</span>";
    onChange(textarea.value);
  };
  textarea.oninput = update;
  preview.innerHTML =
    safePreview(textarea.value) || "<span>Предпросмотр подписи</span>";
  root.append(toolbar, textarea, preview);
  return root;
}

window.PanelEditor = { createHtmlEditor };
