import { GoogleGenAI, Modality } from "@google/genai";
import { HealthReport, UserData } from "../types";

// Helper to decode base64 to Uint8Array
const base64ToUint8Array = (base64String: string): Uint8Array => {
  const binaryString = atob(base64String);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Initialize the Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const validateApiKey = (): { valid: boolean; error?: string } => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return { valid: false, error: "API Key is missing. Please check your Vercel Environment Variables." };
  }
  
  // Clean up any potential formatting issues with the key
  const cleanKey = apiKey.replace(/"/g, '').trim();

  if (cleanKey.startsWith("vck_")) {
    return { 
      valid: false, 
      error: "Configuration Error: You are using a Vercel AI Key ('vck_...'). This app requires a standard Google Cloud API Key (starting with 'AIza...'). Please update the API_KEY environment variable in Vercel Settings." 
    };
  }
  return { valid: true };
};

export const generateHealthReport = async (
  userData: UserData,
  symptoms: string[]
): Promise<HealthReport> => {
  const prompt = `
    You are the Screening Agent for the Niramaya Health AI system.
    Analyze the following patient data for a health report (focusing on diabetes and general wellness risks as per the project proposal).
    
    Patient: ${userData.name}, ${userData.age} years old, ${userData.gender}.
    Report Language: ${userData.language}.
    Symptoms Reported: ${symptoms.join(", ")}.

    Output strictly a JSON object with the following schema:
    {
      "riskLevel": "Low" | "Moderate" | "High",
      "summary": "A 2-3 sentence summary of the health status in ${userData.language} (or English if ${userData.language} is not a written language, but prefer the native script).",
      "recommendations": ["Array of 3 actionable health tips in ${userData.language}"],
      "disclaimer": "A brief medical disclaimer in ${userData.language} stating this is AI screening, not a doctor's diagnosis."
    }
    
    Ensure the tone is culturally sensitive, empathetic, and professional.
  `;

  try {
    // Using gemini-3-flash-preview for reliable text generation and speed
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("The AI model returned an empty response.");
    }

    // Robust parsing: strip markdown code blocks if present
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    
    try {
      return JSON.parse(cleanText) as HealthReport;
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError, "Received text:", text);
      throw new Error("Failed to process the AI report. Please try again.");
    }
  } catch (error: any) {
    console.error("Report Generation Error:", error);
    throw new Error(error.message || "Failed to connect to Gemini API");
  }
};

export const generateAudioNarration = async (
  text: string,
  language: string
): Promise<Uint8Array> => {
  const prompt = `Please narrate the following health advice kindly and clearly in ${language}: "${text}"`;

  try {
    // gemini-2.5-flash-preview-tts is optimized for speech synthesis
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: prompt,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Puck" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return base64ToUint8Array(base64Audio);
    }
    throw new Error("No audio data returned from TTS model");
  } catch (error) {
    console.error("TTS Error:", error);
    throw error;
  }
};

// Converts Raw PCM (16-bit little endian) to AudioBuffer safely
export const createAudioBufferFromPCM = (
  data: Uint8Array, 
  ctx: AudioContext, 
  sampleRate: number = 24000 // Default for Gemini TTS
): AudioBuffer => {
  const numSamples = Math.floor(data.byteLength / 2);
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, numSamples);
  
  const numChannels = 1;
  const buffer = ctx.createBuffer(numChannels, numSamples, sampleRate);
  
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < numSamples; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  
  return buffer;
};