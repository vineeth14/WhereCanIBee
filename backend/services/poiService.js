const overpassProvider = require("./providers/overpassProvider");

const CATEGORIES = {
  restaurants: ["restaurant", "cafe", "bar", "fast_food", "pub"],
  recreation: ["park", "playground"],
};

const getPOIs = async (polygon, category, provider = "overpass") => {
  switch (provider) {
    case "overpass":
      return await overpassProvider.getPOIs(polygon, CATEGORIES[category]);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
};

module.exports = { getPOIs, CATEGORIES };
