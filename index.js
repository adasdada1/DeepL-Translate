import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import deepl from "deepl-node";
import Redis from "ioredis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY;
const translator = new deepl.Translator(API_KEY);

const REDIS_API = process.env.REDIS;
const redis = new Redis(REDIS_API);

async function getTranslation(req, res) {
  const { reviews, targetLang } = req.body;
  if (!reviews || !targetLang) {
    return res.status(400).json({ error: "Missing review or targetLang" });
  }

  const keysWithLang = reviews.map((key) => `${key.text}-${targetLang}`);
  try {
    const promises = keysWithLang.map(async (cacheKey, index) => {
      const cachedTranslation = await redis.get(cacheKey);
      if (cachedTranslation) {
        console.log("in Redis' cache");
        return JSON.parse(cachedTranslation);
      } else {
        console.log("not in cache", cacheKey);
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

        await redis.set(cacheKey, JSON.stringify(translatedTexts));

        return translatedTexts;
      }
    });

    const results = await Promise.all(promises);
    const translatedTexts = results.map((result) => ({
      author: result[0],
      title: result[1],
      text: result[2],
    }));

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

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
