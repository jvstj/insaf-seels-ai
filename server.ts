import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Lazy initialization of Gemini client
let aiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// 1. API Endpoint for AI Chatbot Assistant
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sellerDraft, faqs = [], replies = [], reviews = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "Customer message is required" });
    }

    const ai = getGeminiClient();

    // Context formatting
    const faqContext = faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    const repliesContext = replies.map((r: any) => `- [${r.title}]: ${r.content}`).join("\n");
    const reviewsContext = reviews.map((rev: any) => `- [${rev.platform}] ${rev.customerName}: "${rev.comment}" (Rating: ${rev.rating}/5)`).join("\n");

    let systemInstruction = `
You are a highly skilled Sales Expert and Customer Support Bot for an e-commerce page/shop in Bangladesh named "Insaf AI".
Your task is to reply to customer messages nicely, politely, and persuasively to close sales on Facebook Messenger and WhatsApp.

You MUST read and use the following stored business context to provide highly accurate and relevant responses:
--- FAQ (Frequently Asked Questions) ---
${faqContext || "No FAQs stored yet."}

--- Quick Common Replies / Response Templates ---
${repliesContext || "No quick replies stored yet."}

--- Customer Reviews/Comments (Use these as proof of quality/social proof) ---
${reviewsContext || "No customer reviews stored yet."}
`;

    if (sellerDraft && sellerDraft.trim()) {
      systemInstruction += `
--- SPECIAL INSTRUCTIONS FROM THE SELLER ---
The seller (admin) has provided these specific custom instructions, key points, or partial answer to incorporate or respect in the draft response:
"${sellerDraft}"
You MUST prioritize these specific notes/rules above general knowledge, and include them elegantly in the crafted response.
`;
    }

    systemInstruction += `
Guidelines:
1. If the customer asks a question, check the FAQs first and use that information.
2. If the user query is about popular products or reviews, look at the positive comments/reviews.
3. Keep the tone friendly, polite, energetic, and professional ("Apni/Apnara" in Bengali).
4. Bangla Support: If the customer writes in Bangla, reply in natural Bangla (prefer clean, standard conversational Bangla). If they write in English or Banglish, you can respond in a friendly blend of Bangla and English (common in Bangladesh e-commerce), but make sure it feels authentic and helps close the sale.
5. If some details are not available in the context or the seller notes, reply politely and intelligently based on general e-commerce sales best practices without making up false facts (e.g., about delivery charges, prices, or store hours unless specified in the context). Tell them custom details will be provided by a human teammate shortly.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: message,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ reply: response.text });
  } catch (error: any) {
    console.error("AI Chat Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI response" });
  }
});

// 2. API Endpoint to rewrite a draft into 3/4 professional variations supporting Bengali
app.post("/api/variations", async (req, res) => {
  try {
    const { draft, faqs = [], replies = [], reviews = [] } = req.body;

    if (!draft) {
      return res.status(400).json({ error: "Draft message is required" });
    }

    const ai = getGeminiClient();

    const faqContext = faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
    const repliesContext = replies.map((r: any) => `- [${r.title}]: ${r.content}`).join("\n");

    const systemInstruction = `
You are a brilliant sales content copywriter.
The user will provide a draft response or keyword list meant for a customer.
Your job is to rewrite this reply into Exactly 3 or 4 premium, professional, polite, and sales-focused variations in Bengali (Bangla/Banglish).

Context for terms/products:
--- FAQs ---
${faqContext || ""}
--- Response Templates ---
${repliesContext || ""}

Guidelines:
- Generate 3 or 4 diverse variations (e.g., one ultra-polite, one short & fast, one persuasive with call-to-action, one discount/urgency focused if appropriate).
- High-quality natural Bengali ("Apni" form) or sleek conversational Bengali-English blend suited for F-Commerce and WhatsApp sales in Bangladesh.
- Format the response strictly as a JSON list of strings (an array of strings), containing ONLY the variations. 
- Do not output markdown code blocks (like \`\`\`json ... \`\`\`) in your text unless they are within the response schema requirement, but to ensure perfect parsing: output a valid JSON array of strings.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Draft to rewrite: "${draft}"`,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.8,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          },
          description: "A list of 3-4 professional alternative variations of the draft text."
        }
      },
    });

    let variations = [];
    try {
      variations = JSON.parse(response.text || "[]");
    } catch {
      // Fallback in case of parse error
      variations = [response.text];
    }

    res.json({ variations });
  } catch (error: any) {
    console.error("Variations Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate variations" });
  }
});

// Vite Middleware & Static Serving setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
