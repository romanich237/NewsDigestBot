"use strict";

function labelForTimezone(timezone) {
  try {
    const part = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date())
      .find((item) => item.type === "timeZoneName")?.value;
    return `${part?.replace("GMT", "UTC") || "UTC"} (${timezone})`;
  } catch {
    return timezone;
  }
}

window.PanelFields = {
  newsApiCategories: [
    ["business", "Бизнес"],
    ["entertainment", "Развлечения"],
    ["general", "Общие новости"],
    ["health", "Здоровье"],
    ["science", "Наука"],
    ["sports", "Спорт"],
    ["technology", "Технологии"],
  ],
  timezones: Array.from({ length: 27 }, (_, index) => {
    const offset = index - 12;
    const sign = offset >= 0 ? "+" : "-";
    const label = `UTC${sign}${String(Math.abs(offset)).padStart(2, "0")}:00`;
    const value =
      offset === 0
        ? "UTC"
        : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
    return [value, label];
  }),
  labelForTimezone,
};
