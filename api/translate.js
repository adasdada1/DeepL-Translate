import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import deepl from "deepl-node";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY;
const translator = new deepl.Translator(API_KEY);

const cache = new Map();
const MAX_CACHE_SIZE = 300;

function addToCache(key, value) {
  if (cache.size >= MAX_CACHE_SIZE && cache.size > 0) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, value);
}

async function getTranslation(req, res) {
  const { reviews, targetLang } = req.body;
  if (!reviews || !targetLang) {
    return res.status(400).json({ error: "Missing review" });
  }

  const keysWithLang = reviews.map((key) => `${key.text}-${targetLang}`);
  try {
    const promises = keysWithLang.map(async (cacheKey, index) => {
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      } else {
        const review = reviews[index];
        const textsToTranslate = [
          review.author ? review.author : "-1-1-1-",
          review.title ? review.title : "-1-1-1-",
          review.text ? review.text : "-1-1-1-",
        ];

        const result = await translator.translateText(
          textsToTranslate,
          null,
          targetLang
        );
        const translatedTexts = result.map((item) =>
          item.text === "-1-1-1-" ? "" : item.text
        );
        addToCache(cacheKey, translatedTexts);
        return translatedTexts;
      }
    });

    const results = await Promise.allSettled(promises);
    const translatedTexts = results.map((result) => {
      if (result.status === "fulfilled") {
        return {
          author: result.value[0],
          title: result.value[1],
          text: result.value[2],
        };
      } else {
        console.error("Translation failed:", result.reason);
        return "Error";
      }
    });

    res.json({ translatedTexts });
  } catch (error) {
    console.error("Translation error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
}

app.get("/", (req, res) => {
  res.send("Welcome");
});

app.post("/translate", getTranslation);

export default app;