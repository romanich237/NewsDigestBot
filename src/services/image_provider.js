const axios = require("axios");

const STOP_WORDS = new Set([
  "для",
  "как",
  "что",
  "это",
  "его",
  "она",
  "они",
  "или",
  "при",
  "про",
  "без",
  "после",
  "новый",
  "новая",
  "новости",
  "россия",
  "россии",
  "свой",
  "свои",
]);

function queryFromPost(post) {
  const text = `${post.title || ""} ${post.summary || ""}`
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, " ");
  return [
    ...new Set(
      text
        .split(/\s+/)
        .filter((word) => word.length > 3 && !STOP_WORDS.has(word)),
    ),
  ]
    .slice(0, 6)
    .join(" ");
}

class ImageProvider {
  constructor(config) {
    this.config = config.images || {};
  }

  async find(post) {
    if (!this.config.enabled || this.config.provider !== "unsplash")
      return null;
    if (
      !this.config.access_key ||
      String(this.config.access_key).startsWith("YOUR_")
    )
      return null;
    const query = queryFromPost(post);
    if (!query) return null;
    try {
      const response = await axios.get(
        "https://api.unsplash.com/search/photos",
        {
          timeout: 12000,
          headers: { Authorization: `Client-ID ${this.config.access_key}` },
          params: {
            query,
            per_page: 1,
            orientation: this.config.orientation || "landscape",
          },
        },
      );
      const photo = response.data?.results?.[0];
      if (!photo?.urls?.regular) return null;
      if (photo.links?.download_location) {
        axios
          .get(photo.links.download_location, {
            timeout: 5000,
            headers: { Authorization: `Client-ID ${this.config.access_key}` },
          })
          .catch(() => {});
      }
      return {
        url: photo.urls.regular,
        author: photo.user?.name || photo.user?.username || "Unsplash",
        authorUrl: `${photo.user?.links?.html || "https://unsplash.com"}?utm_source=newsdigestbot&utm_medium=referral`,
        providerUrl:
          "https://unsplash.com/?utm_source=newsdigestbot&utm_medium=referral",
      };
    } catch (error) {
      console.error(
        `[IMAGE] ${error.response?.status ? `HTTP ${error.response.status}` : error.message}`,
      );
      return null;
    }
  }
}

module.exports = { ImageProvider, queryFromPost };
