
import { GoogleGenAI } from "@google/genai";
import { ProductAnalysis, DesignMode, RopeType, PRODUCT_MATERIALS, AppTab } from "../types";

// --- KEY MANAGER LOGIC ---
class KeyManager {
  private keys: string[] = [];
  private index = 0;

  setKeys(keys: string[]) {
    const parsedKeys: string[] = [];
    keys.forEach(k => {
        if (!k) return;
        const splits = k.split(/[\n\r,;]+/).map(s => s.trim()).filter(s => s.length > 20);
        parsedKeys.push(...splits);
    });

    this.keys = [...new Set(parsedKeys)];
    this.index = 0;
    console.log(`Key Manager Initialized: ${this.keys.length} Unique Keys`);
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  async executeWithRetry<T>(operation: (key: string) => Promise<T>): Promise<T> {
    const envKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    
    if (!this.hasKeys()) {
       if (!envKey) throw new Error("No API Keys configured.");
       return operation(envKey);
    }

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
            const status = error?.status;

            // Rate Limit (429) or Service Unavailable (503) -> Rotate Key
            const isRateLimit = status === 429 || msg.includes('429') || msg.includes('quota');
            const isOverloaded = status === 503 || msg.includes('503');
            
            if (isRateLimit || isOverloaded) {
                console.warn(`Key ending in ...${key.slice(-4)} failed (${status}). Rotating...`);
                await sleep(1000); 
                continue; 
            }
            
            // For 403 (Permission) or 400 (Bad Request), strictly throw so the inner logic can handle fallback
            throw error; 
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
    const keys = tokenInput.split(/[\n\r,;]+/).map(s => s.trim()).filter(s => s.length > 20);
    
    if (keys.length === 0) {
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
      await sleep(500);

      const prompt = `Task: Background Removal & cleanup.
      1. Remove only the outer background. Replace it with pure white (#FFFFFF).
      2. Preserve the entire design including all inner white details, highlights, strokes, and text edges.
      3. Do not remove any white elements that are part of the artwork.
      4. Remove any strings, ropes, or hanging loops attached to the object.
      5. Output as a high-quality image with smooth edges.`;

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
            prompt = `Analyze this design. Return JSON: { description, designCritique, detectedComponents, redesignPrompt }. 
            For 'redesignPrompt': Write a creative T-Shirt design prompt. 
            Identify the core theme (e.g., Cute, Edgy, Typography, Vintage, Anime).
            The prompt should aim for a "Trending on Pinterest/Etsy" look. Youthful, Eye-catching, and Modern.`;
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

        let safeCritique = rawResult.designCritique;
        if (typeof safeCritique === 'object' && safeCritique !== null) {
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
  return []; 
};

export const generateProductRedesigns = async (
    basePrompt: string,
    ropeType: RopeType,
    selectedComponents: string[],
    userNotes: string,
    productType: string,
    useUltraFlag: boolean,
    activeTab: AppTab = AppTab.POD
  ): Promise<string[]> => {
    
    let finalPrompt = basePrompt;
    let targetModel = 'gemini-3-pro-image-preview';
    let targetConfig: any = { imageConfig: { imageSize: '2K', aspectRatio: '1:1' } };

    if (activeTab === AppTab.TSHIRT) {
        // Enforce gemini-2.5-flash-image for T-Shirt
        targetModel = 'gemini-2.5-flash-image';
        // Flash does not support imageSize
        targetConfig = { imageConfig: { aspectRatio: '1:1' } };

        finalPrompt += `
**DESIGN TASK:** Create a High-Quality **VECTOR T-SHIRT ILLUSTRATION**.

**ART STYLE (CRITICAL):**
- **Theme:** Retro/Vintage aesthetic mixed with Modern Streetwear.
- **Style:** Detailed Vector Art, Mascot Illustration, Sticker Art.
- **Vibe:** Cool, Groovy, Vibrant, detailed shading but clean lines.
- **Reference Style:** Think "80s/90s Pop Culture", "Skateboard Deck Art", or "High-end Sticker Design".

**TECHNICAL RULES:**
1. **Background:** PURE WHITE (#FFFFFF). No background scenery.
2. **Format:** Isolated Graphic. Ready-to-print.
3. **Lines:** Strong, confident outlines (thick outer line, thinner inner details).
4. **Colors:** Rich, saturated, and contrasting colors.
5. **No 3D Realism:** Do NOT make it look like a photograph. Make it look like a DRAWING/ILLUSTRATION.`;
    } else {
        finalPrompt += `\n\nCreate a photorealistic product mockup. Cinematic lighting. High Resolution. 8K. detailed.`;
    }
    
    if (userNotes) finalPrompt += `\nUser Note: ${userNotes}`;

    const count = activeTab === AppTab.TSHIRT ? 3 : 6;
    
    const results: string[] = [];
    for(let i=0; i<count; i++) {
        await sleep(500); 
        const img = await keyManager.executeWithRetry(async (key) => {
             const ai = getClient(key);
             
             if (activeTab === AppTab.TSHIRT) {
                 const response = await ai.models.generateContent({
                    model: targetModel,
                    contents: { parts: [{ text: finalPrompt }] },
                    config: targetConfig
                });
                for (const part of response.candidates?.[0]?.content?.parts || []) {
                    if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
                }
             } else {
                 try {
                    const response = await ai.models.generateContent({
                        model: 'gemini-3-pro-image-preview',
                        contents: { parts: [{ text: finalPrompt }] },
                        config: { imageConfig: { imageSize: '2K', aspectRatio: '1:1' } }
                    });
                    for (const part of response.candidates?.[0]?.content?.parts || []) {
                        if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
                    }
                 } catch (err: any) {
                     const isAuthError = err.status === 403 || err.status === 404 || err.message?.includes('PERMISSION_DENIED');
                     
                     if (isAuthError) {
                         console.warn(`Gemini 3 Pro blocked (${err.status}). Falling back to Gemini 2.5 Flash Image.`);
                         const fallbackModel = 'gemini-2.5-flash-image';
                         const fallbackConfig = { imageConfig: { aspectRatio: '1:1' } };

                         const response = await ai.models.generateContent({
                            model: fallbackModel,
                            contents: { parts: [{ text: finalPrompt }] },
                            config: fallbackConfig
                        });
                        for (const part of response.candidates?.[0]?.content?.parts || []) {
                            if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
                        }
                     }
                     throw err; 
                 }
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

        try {
            const modelName = 'gemini-2.5-flash-image'; 
            const config = { imageConfig: { aspectRatio: '1:1' } };
            
            const response = await ai.models.generateContent({
                model: modelName,
                contents: {
                    parts: [
                        { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                        { text: `Edit image: ${instruction}. Maintain the youthful/trendy style. Make it Bold. White Background. Do NOT make a mockup, just raw design.` }
                    ]
                },
                config: config
            });
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData && part.inlineData.data) return `data:image/png;base64,${part.inlineData.data}`;
            }
        } catch (err: any) {
             console.error("Remix failed", err);
             throw err;
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

export const generateSmartMockup = async (imageBase64: string): Promise<string> => {
    return keyManager.executeWithRetry(async (key) => {
        const ai = getClient(key);
        const modelName = 'gemini-2.5-flash-image';
        const config = { imageConfig: { aspectRatio: '1:1' } };

        const prompt = `
        Act as a professional Fashion Art Director.
        Input: The provided graphic design.
        Task: Create a HIGH-END PHOTOREALISTIC T-SHIRT MOCKUP.
        Auto-pick T-Shirt color (White or Black) based on what makes the design pop.
        Scene: Fit model, cinematic lighting.
        `;

        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: [
                    { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                    { text: prompt }
                ]
            },
            config: config
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData && part.inlineData.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
        throw new Error("Failed to generate smart mockup");
    });
};

export const generateSmartMockupBatch = async (imageBase64: string): Promise<string[]> => {
    // Generate 6 Variations
    const variations = [
        "Male model, Black T-Shirt, Street Style",
        "Female model, White T-Shirt, Casual",
        "Male model, White T-Shirt, Studio Lighting",
        "Female model, Black T-Shirt, Urban vibe",
        "Flat lay, Folded T-Shirt, Minimalist background",
        "Close-up of chest area, showing fabric texture"
    ];

    const results: string[] = [];

    // Run parallel or sequential - Sequential safer for rate limits in this context
    for (const vibe of variations) {
        await sleep(300); // Slight delay
        try {
            const res = await keyManager.executeWithRetry(async (key) => {
                const ai = getClient(key);
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: {
                        parts: [
                            { inlineData: { mimeType: "image/jpeg", data: stripBase64Prefix(imageBase64) } },
                            { text: `Create a photorealistic T-Shirt Mockup. ${vibe}. High quality. Design must be clearly visible.` }
                        ]
                    },
                    config: { imageConfig: { aspectRatio: '1:1' } }
                });
                for (const part of response.candidates?.[0]?.content?.parts || []) {
                    if (part.inlineData && part.inlineData.data) {
                        return `data:image/png;base64,${part.inlineData.data}`;
                    }
                }
                return null;
            });
            if (res) results.push(res);
        } catch (e) {
            console.warn("Mockup batch item failed", e);
        }
    }
    return results;
};
