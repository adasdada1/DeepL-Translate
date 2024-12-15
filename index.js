import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import deepl from "deepl-node";
import Redis from "ioredis";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://www.doscosmetics.com",
  "https://www.doscosmetics.gr",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
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

  const keysWithLang = reviews.map((review) => `${review.text}-${targetLang}`);
  const missingCacheKeys = [];

  try {
    const cachedTranslations = await redis.mget(keysWithLang);
    const translatedTextsPromises = keysWithLang.map((cacheKey, index) => {
      const cachedTranslation = cachedTranslations[index];
      if (cachedTranslation) {
        console.log("in Redis' cache");
        return JSON.parse(cachedTranslation);
      } else {
        console.log("not in cache", cacheKey);
        missingCacheKeys.push(index);
        return null;
      }
    });

    const textsToTranslate = missingCacheKeys.map((index) => {
      const review = reviews[index];
      return [
        review.author || "-1-1-1-",
        review.title || "-1-1-1-",
        review.text || "-1-1-1-",
      ];
    });

    const translatedResults = await Promise.all(
      textsToTranslate.map((texts) =>
        translator.translateText(texts, null, targetLang)
      )
    );

    missingCacheKeys.forEach((index, i) => {
      const translatedTexts = translatedResults[i].map((item) =>
        item.text === "-1-1-1-" ? "" : item.text
      );
      redis.set(cacheKey, JSON.stringify(translatedTexts));
    });

    const translatedTexts = translatedTextsPromises.map((result, index) => {
      if (result) {
        return { author: result[0], title: result[1], text: result[2] };
      } else {
        const newTranslated =
          translatedResults[missingCacheKeys.indexOf(index)];
        return {
          author: newTranslated[0],
          title: newTranslated[1],
          text: newTranslated[2],
        };
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

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
