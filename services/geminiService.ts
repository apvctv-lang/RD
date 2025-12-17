
import { GoogleGenAI } from "@google/genai";
import { ProductAnalysis, DesignMode, RopeType, PRODUCT_MATERIALS, AppTab } from "../types";

// --- KEY MANAGER LOGIC ---
class KeyManager {
  private keys: string[] = [];
  private index = 0;

  setKeys(keys: string[]) {
    // Support parsing newline/comma separated keys from a single string
    const parsedKeys: string[] = [];
    keys.forEach(k => {
        if (!k) return;
        // Split by newline (\n), carriage return (\r), comma, or semicolon
        // Filter out empty strings and strings too short to be keys
        const splits = k.split(/[\n\r,;]+/).map(s => s.trim()).filter(s => s.length > 20);
        parsedKeys.push(...splits);
    });

    // Remove duplicates
    this.keys = [...new Set(parsedKeys)];
    this.index = 0;
    console.log(`Key Manager Initialized: ${this.keys.length} Unique Keys`);
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  async executeWithRetry<T>(operation: (key: string) => Promise<T>): Promise<T> {
    const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    
    // If no dynamic keys, use Env Key
    if (!this.hasKeys()) {
       if (!envKey) throw new Error("No API Keys configured.");
       return operation(envKey);
    }

    // Try Keys Loop
    let initialIndex = this.index;
    let lastError: any = null;

    for (let i = 0; i < this.keys.length; i++) {
        const currentKeyIndex = (initialIndex + i) % this.keys.length;
        const key = this.keys[currentKeyIndex];
        
        try {
            this.index = (currentKeyIndex + 1) % this.keys.length;
            return await operation(key);
        } catch (error: any) {
            lastError = error;
            const msg = error?.message || '';
            const isRateLimit = error?.status === 429 || msg.includes('429') || msg.includes('quota');
            const isOverloaded = error?.status === 503 || msg.includes('503');
            
            if (isRateLimit || isOverloaded) {
                console.warn(`Key ending in ...${key.slice(-4)} failed. Rotating...`);
                await sleep(1000); 
                continue; 
            }
            throw error; // Throw other errors (400, 403) immediately
        }
    }

    throw lastError || new Error("All API Keys are currently unavailable.");
  }
}

export const keyManager = new KeyManager();

// --- CLIENT FACTORY ---
const getClient = (key: string) => {
  return new GoogleGenAI({ apiKey: key });
};

const stripBase64Prefix = (base64: string) => {
  return base64.replace(/^data:image\/[a-z]+;base64,/, "");
};

export const cleanJsonString = (text: string) => {
    return text.replace(/```json\s*|\s*```/g, "").trim();
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- EXPORTED SERVICES ---

export const setKeyPools = (keys: string[]) => {
  keyManager.setKeys(keys);
};

export const validateToken = async (tokenInput: string): Promise<boolean> => {
  try {
    // Robust splitting: Handles \n, \r, comma, semicolon
    const keys = tokenInput.split(/[\n\r,;]+/).map(s => s.trim()).filter(s => s.length > 20);
    
    if (keys.length === 0) {
        // Fallback: Try raw input if it looks like a key but failed regex/length check
        if (tokenInput.trim().length > 10) {
             const ai = getClient(tokenInput.trim());
             await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: { parts: [{ text: "test" }] }
             });
             return true;
        }
        throw new Error("Invalid API Key format");
    }

    // Validate only the first key to save time
    const ai = getClient(keys[0]);
    await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts: [{ text: "test" }] }
    });
    return true;
  } catch (err: any) {
    console.error("Validation error:", err);
    throw err;
  }
};

export const cleanupProductImage = async (imageBase64: string): Promise<string> => {
  return keyManager.executeWithRetry(async (key) => {
      const ai = getClient(key);
      // Wait slightly to prevent rapid-fire blocks
      await sleep(500);

      // AGGRESSIVE CLEANUP PROMPT
      const prompt = `Image Editing Task:
      1. ISOLATE the main product object on a pure solid WHITE background (Hex #FFFFFF).
      2. REMOVE STRINGS: Completely ERASE and DELETE any hanging strings, jute ropes, ribbons, hooks, holes, or wires attached to the product.
      3. CRITICAL: Remove the loop/hole at the top of the ornament if it exists. Make the top edge smooth.
      4. The result should look like the product is floating, with NO attachment mechanism visible.
      5. Output: Return ONLY the image.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
            { text: prompt }
          ]
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData && part.inlineData.data) {
              return `data:image/png;base64,${part.inlineData.data}`;
          }
      }
      return imageBase64;
  });
};

export const analyzeProductDesign = async (
    imageBase64: string, 
    productType: string,
    designMode: DesignMode,
    activeTab: AppTab = AppTab.POD
  ): Promise<ProductAnalysis> => {
    
    return keyManager.executeWithRetry(async (key) => {
        const ai = getClient(key);
        const activeModel = 'gemini-2.5-flash';
        await sleep(500);

        let prompt = "";
        if (activeTab === AppTab.TSHIRT) {
            prompt = `Analyze this T-Shirt Design. Return JSON: { description, designCritique, detectedComponents, redesignPrompt }. For 'redesignPrompt', request a SINGLE UNIFIED GRAPHIC on WHITE background.`;
        } else {
            prompt = `Analyze this product image. Return JSON: { description, designCritique, detectedComponents, redesignPrompt }. For 'redesignPrompt', request a high-quality product photography mockup.`;
        }
        
        const response = await ai.models.generateContent({
            model: activeModel,
            contents: {
            parts: [
                { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                { text: prompt }
            ]
            },
            config: { responseMimeType: "application/json" }
        });

        const text = response.text || "{}";
        const rawResult = JSON.parse(cleanJsonString(text));

        let components = rawResult.detectedComponents;
        if (typeof components === 'string') components = components.split(',');
        if (!Array.isArray(components)) components = [];

        // SAFETY CHECK: Ensure string fields are actually strings
        let safeCritique = rawResult.designCritique;
        if (typeof safeCritique === 'object' && safeCritique !== null) {
            // Flatten object to string to PREVENT REACT CRASH
            safeCritique = Object.entries(safeCritique)
                .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                .join('\n');
        } else if (typeof safeCritique !== 'string') {
            safeCritique = "Analysis completed.";
        }

        let safeDescription = rawResult.description;
        if (typeof safeDescription !== 'string') safeDescription = "No description generated.";

        let safePrompt = rawResult.redesignPrompt;
        if (typeof safePrompt !== 'string') safePrompt = "";

        return { 
            description: safeDescription, 
            designCritique: safeCritique, 
            detectedComponents: components,
            redesignPrompt: safePrompt
        } as ProductAnalysis;
    });
  };

export const extractDesignElements = async (imageBase64: string): Promise<string[]> => {
  // FUNCTION DISABLED TO SPEED UP APP AS REQUESTED
  return []; 
};

export const generateProductRedesigns = async (
    basePrompt: string,
    ropeType: RopeType,
    selectedComponents: string[],
    userNotes: string,
    productType: string,
    useUltraFlag: boolean, // Parameter kept for compatibility but ignored
    activeTab: AppTab = AppTab.POD
  ): Promise<string[]> => {
    
    let finalPrompt = basePrompt;
    if (activeTab === AppTab.TSHIRT) {
        finalPrompt += `\n\nOUTPUT: ONE SINGLE IMAGE ONLY. Centered graphic on white background. NO grid. NO multiple variations.`;
    } else {
        finalPrompt += `\n\nCreate a photorealistic product mockup. Cinematic lighting. High Resolution. 8K. detailed.`;
    }
    if (userNotes) finalPrompt += `\nUser Note: ${userNotes}`;

    const count = activeTab === AppTab.TSHIRT ? 3 : 6;
    
    const results: string[] = [];
    for(let i=0; i<count; i++) {
        await sleep(500); // Gentle pacing
        const img = await keyManager.executeWithRetry(async (key) => {
             const ai = getClient(key);
             const modelName = 'gemini-3-pro-image-preview'; // Banana Pro / High Quality
             
             // UPGRADE TO 2K RESOLUTION (High Quality)
             // gemini-3-pro-image-preview supports '1K', '2K', '4K'
             const config = { imageConfig: { imageSize: '2K', aspectRatio: '1:1' } };

             const response = await ai.models.generateContent({
                model: modelName,
                contents: { parts: [{ text: finalPrompt }] },
                config: config
             });
             for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
             }
             return null;
        }).catch((e) => {
            console.warn("Generation failed for one item", e);
            return null;
        });
        if (img) results.push(img);
    }
    return results;
};

export const remixProductImage = async (imageBase64: string, instruction: string): Promise<string> => {
    return keyManager.executeWithRetry(async (key) => {
        const ai = getClient(key);
        const modelName = 'gemini-3-pro-image-preview'; 
        // Remix also uses 2K
        const config = { imageConfig: { imageSize: '2K', aspectRatio: '1:1' } };
        
        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: `Edit image: ${instruction}. High resolution, 8k.` }
                ]
            },
            config: config
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("Remix failed");
    });
};

export const detectAndSplitCharacters = async (imageBase64: string): Promise<string[]> => {
    return []; 
};

export const generateRandomMockup = async (imageBase64: string): Promise<string> => {
    return imageBase64; 
};
