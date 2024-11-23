import { createClient } from "@supabase/supabase-js";
import { Anthropic } from "@anthropic/sdk";
import { Buffer } from "node:buffer";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const headers = {
  "Content-Type": "application/json",
};

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

async function createDermatologyAssessment(
  images: string[],
  concern: string,
  skinType: string,
): Promise<Anthropic.Messages.Message> {
  const imageContent = images.map((imageData) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: imageData,
    },
  }));

  const textContent = {
    type: "text" as const,
    text: `
You are a dermatology-focused AI assistant designed to analyze skin conditions from photographs and provide helpful recommendations. Your task is to examine three photographs of a user's face and provide insights based on the following information:\n\nSkin Concern:\n<skin_concern>\n${concern}\n</skin_concern>\n\nSkin Type:\n<skin_type>\n${skinType}\n</skin_type>\n\nInstructions:\n\n1. Analyze the three photographs of the user's face. In your analysis, consider the following aspects:\n   a. Examine each photograph separately, noting any visible skin issues.\n   b. Relate your observations to the user's stated skin concern and skin type.\n   c. Consider potential causes for each observed issue.\n   d. Reflect on any limitations in your analysis (e.g., image quality, lighting).\n\n2. Record your detailed analysis using <photo_analysis> tags. For each photo:\n   - List visible skin issues\n   - Relate observations to the user's concern and skin type\n   - Consider potential causes\n   After analyzing all three photos:\n   - Summarize common issues across all photos\n   - Note any limitations in your analysis\n   This is your opportunity to think through all aspects of the skin condition before providing a concise summary.\n\n3. After your analysis, provide a summary of your observations and recommendations in the following format:\n\n<observations>\n[List the key skin issues you've identified, numbered for clarity]\n</observations>\n\n<recommendations>\n[Provide detailed skincare recommendations, focusing on types of treatments or procedures. Do not suggest specific products. Include a variety of treatment options that could address the identified issues. Number each recommendation for clarity.]\n</recommendations>\n\nImportant Notes:\n- Be specific about the skin issues you observe and how they relate to the user's concern and skin type.\n- In your recommendations, focus on types of treatments or procedures (e.g., botox, laser treatment, microneedling) rather than specific products.\n- Provide detailed information about potential treatments, but avoid naming or recommending specific brands or products.\n- Keep your overall response informative and practical.\n- Avoid speculative diagnoses, especially for potentially serious conditions.\n\nHere's an example of how your response should be structured (note that this is a generic example and your actual response should be tailored to the specific case):\n\n<photo_analysis>\n[Your thorough analysis of each photograph, relating observations to the user's concern and skin type, considering potential causes, summarizing common issues, and noting limitations]\n</photo_analysis>\n\n<observations>\n1. [Observation 1]\n2. [Observation 2]\n3. [Observation 3]\n</observations>\n\n<recommendations>\n1. [Treatment option 1 - type of procedure or treatment, not a specific product]\n2. [Treatment option 2 - type of procedure or treatment, not a specific product]\n3. [Treatment option 3 - type of procedure or treatment, not a specific product]\n4. [General skincare advice relevant to the observed issues]\n</recommendations>\n\nPlease proceed with your analysis and recommendations based on the provided skin concern and skin type.    
`,
  };

  return await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [...imageContent, textContent],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text" as const,
            text: "<photo_analysis>",
          },
        ],
      },
    ],
  });
}

interface RecommendationItem {
  title: string;
  details: string[];
}

interface ParsedDermatologyResponse {
  photoAnalysis: string;
  observations: string[];
  recommendations: RecommendationItem[];
}

function parseAnthropicResponse(
  response: Anthropic.Messages.Message,
): ParsedDermatologyResponse {
  let content = response.content[0].type === "text"
    ? response.content[0].text
    : "";

  content = `<photo_analysis>\n${content}`;

  const extractContent = (text: string, tag: string): string => {
    const regex = new RegExp(`<${tag}>(.*?)<\/${tag}>`, "s");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
  };

  const parseNumberedList = (text: string): string[] => {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+\./.test(line))
      .map((line) => line.replace(/^\d+\.\s*/, "").trim());
  };

  const parseRecommendations = (text: string): RecommendationItem[] => {
    const recommendations: RecommendationItem[] = [];
    const lines = text.split("\n").map((line) => line.trim());

    let currentItem: RecommendationItem | null = null;

    for (const line of lines) {
      const mainPointMatch = line.match(/^\d+\.\s*(.*?):/);

      if (mainPointMatch) {
        if (currentItem) {
          recommendations.push(currentItem);
        }
        currentItem = {
          title: mainPointMatch[1],
          details: [],
        };
      } else if (currentItem && line.startsWith("-")) {
        currentItem.details.push(line.replace(/^-\s*/, "").trim());
      }
    }

    if (currentItem) {
      recommendations.push(currentItem);
    }

    return recommendations;
  };

  const photoAnalysis = extractContent(content, "photo_analysis");
  const observationsText = extractContent(content, "observations");
  const recommendationsText = extractContent(content, "recommendations");

  return {
    photoAnalysis,
    observations: parseNumberedList(observationsText),
    recommendations: parseRecommendations(recommendationsText),
  };
}

Deno.serve(async (req) => {
  const body = await req.formData();

  const face_front = body.get("face_front");
  const face_left = body.get("face_left");
  const face_right = body.get("face_right");

  if (!face_front || !face_left || !face_right) {
    return new Response(
      JSON.stringify({ error: "No file provided" }),
      {
        status: 400,
        headers: headers,
      },
    );
  }
  if (
    !(face_front instanceof File) || !(face_left instanceof File) ||
    !(face_right instanceof File)
  ) {
    return new Response(
      JSON.stringify({ error: "Invalid file type" }),
      {
        status: 400,
        headers: headers,
      },
    );
  }

  const base64FaceFront = await convertFileToBase64(face_front);
  const base64FaceLeft = await convertFileToBase64(face_left);
  const base64FaceRight = await convertFileToBase64(face_right);

  const response = await createDermatologyAssessment(
    [base64FaceFront, base64FaceLeft, base64FaceRight],
    "acne",
    "normal",
  );

  console.log(response);

  const parsedResponse = parseAnthropicResponse(response);

  return new Response(
    JSON.stringify(parsedResponse),
    {
      headers: headers,
    },
  );
});

async function convertFileToBase64(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return base64;
}
