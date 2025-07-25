import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import deepl from "deepl-node";
import Redis from "ioredis";
import axios from "axios";
import crypto from "crypto";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://www.doscosmetics.com",
  "https://www.doscosmetics.gr",
  "https://deep-l-translate.vercel.app",
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

app.use(express.json());
app.use(cors(corsOptions));

const API_KEY = process.env.API_KEY;
const translator = new deepl.Translator(API_KEY);

const REDIS_API = process.env.REDIS;
const redis = new Redis(REDIS_API);

// Helper: SHA256 hashing for user_data
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

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
      const cacheKey = keysWithLang[index];
      redis.set(cacheKey, JSON.stringify(translatedTexts));
    });

    const translatedTexts = translatedTextsPromises.map((result, index) => {
      if (result) {
        return { author: result[0], title: result[1], text: result[2] };
      } else {
        const missingIndex = missingCacheKeys.indexOf(index);
        if (missingIndex === -1) {
          return { author: "", title: "", text: "" };
        }
        const newTranslated = translatedResults[missingIndex];
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



app.post("/fb-generic-event", async (req, res) => {
  try {
    const {
      event_name,
      event_time,
      event_id,
      event_source_url,
      action_source,
      user_data,
      custom_data,
    } = req.body;

    const client_ip_address =
      req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (client_ip_address && !user_data.client_ip_address) {
      user_data.client_ip_address = client_ip_address;
    }

    // Проверка наличия обязательных полей
    if (!event_name || !event_time || !event_id) {
      return res.status(400).send("Missing required event parameters.");
    }

    // Хешируем email, если он есть. Facebook требует SHA256.
    if (user_data.em) {
      user_data.em = crypto
        .createHash("sha256")
        .update(user_data.em.toLowerCase())
        .digest("hex");
    }

    const eventData = {
      event_name: event_name,
      event_time: event_time,
      event_id: event_id,
      event_source_url: event_source_url,
      action_source: action_source,
      user_data: user_data,
      custom_data: custom_data,
    };

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${process.env.PIXEL_ID}/events?access_token=${process.env.ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [eventData],
        }),
      }
    );

    const responseData = await response.json();
    console.log("CAPI Response for " + event_name + ":", responseData);

    if (!response.ok) {
      throw new Error("Facebook CAPI request failed.");
    }

    res
      .status(200)
      .json({ success: true, message: `Event ${event_name} received` });
  } catch (error) {
    console.error("CAPI Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});



app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
