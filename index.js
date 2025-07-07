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
  "https://deep-l-translate.vercel.app"
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

app.post("/fb-add-to-cart", async (req, res) => {
  try {
    const {
      event_name,
      event_time,
      event_id,
      content_ids,
      content_name,
      value,
      currency,
      user_email,
      user_ip,
      user_agent,
    } = req.body;

    // Build user_data with optional hashing
    const user_data = {};
    if (user_email) {
      user_data.em = sha256(user_email.trim().toLowerCase());
    }
    if (user_ip) {
      user_data.client_ip_address = user_ip;
    }
    if (user_agent) {
      user_data.client_user_agent = user_agent;
    }

    // Prepare payload
    const payload = {
      data: [
        {
          event_name,
          event_time,
          event_id,
          user_data,
          custom_data: { content_ids, content_name, value, currency },
        },
      ],
    };

    // Send to Meta Conversions API
    const url = `https://graph.facebook.com/v15.0/${process.env.PIXEL_ID}/events`;
    const response = await axios.post(url, payload, {
      params: { access_token: process.env.ACCESS_TOKEN },
    });

    console.log("FB CAPI response:", response.data);
    res.json({ success: true, result: response.data });
  } catch (error) {
    console.error("FB CAPI error:", error.response?.data || error.message);
    res
      .status(500)
      .json({ success: false, error: error.response?.data || error.message });
  }
});

app.get("/", (req, res) => {
  res.send("Welcome");
});

app.post("/translate", getTranslation);

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});
