import fs from "fs";

const dict1 = JSON.parse(fs.readFileSync("scripts/translation_dictionary.json", "utf8"));
const dict2 = JSON.parse(fs.readFileSync("scripts/complete_translation_dictionary.json", "utf8"));

// Merge dict1 (which user edited) into a unified dictionary
const mergedMap = new Map();

for (const group of dict1) {
  if (!mergedMap.has(group.category)) {
    mergedMap.set(group.category, { category: group.category, note: group.note || "", translations: {} });
  }
  const target = mergedMap.get(group.category);
  for (const [k, v] of Object.entries(group.translations)) {
    target.translations[k] = v;
  }
}

for (const group of dict2) {
  // Check if we can merge or add
  let matchedCat = null;
  for (const [existingCat] of mergedMap.entries()) {
    if (existingCat.includes(group.category.split(" ")[0])) {
      matchedCat = existingCat;
      break;
    }
  }
  if (!matchedCat) {
    matchedCat = group.category;
    mergedMap.set(matchedCat, { category: matchedCat, note: "", translations: {} });
  }
  const target = mergedMap.get(matchedCat);
  for (const [k, v] of Object.entries(group.translations)) {
    // If not already defined by user in dict1, set it
    if (!target.translations[k]) {
      target.translations[k] = v;
    }
  }
}

const finalOutput = Array.from(mergedMap.values());
fs.writeFileSync("scripts/translation_dictionary.json", JSON.stringify(finalOutput, null, 2));
console.log("Merged dictionary saved. Categories:", finalOutput.length);
