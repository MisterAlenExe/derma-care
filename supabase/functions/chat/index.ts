import { createClient } from "@supabase/supabase-js";
import { Anthropic } from "@anthropic/sdk";

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
    text:
      `You will receive three photographs of a person's face, along with their primary skin concern is ${concern} and skin type is ${skinType}. Your task is to:
Identify visible skin issues related to the concern and skin type.
Offer a concise skincare recommendation or product suggestion.
Emphasize the importance of consulting a dermatologist for personalized advice.
Keep responses brief and practical. Would you like further clarification or assistance?`,
  };

  return await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 400,
    temperature: 0,
    system:
      "You are a dermatology-focused chatbot designed to assist users with skin-related concerns, provide general information, and guide users to appropriate actions based on their descriptions. Your primary responsibilities are:\n\nTo offer empathetic, non-judgmental, and user-friendly responses.\nTo provide accurate, medically informed, and evidence-based dermatological advice within your limitations.\nTo clearly state that you are not a substitute for a licensed dermatologist and recommend professional consultation when necessary.\nTo ensure user safety by avoiding speculative diagnoses, especially for potentially serious conditions, and encouraging medical evaluation where appropriate.",
    messages: [
      {
        role: "user",
        content: [...imageContent, textContent],
      },
    ],
  });
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

  return new Response(
    JSON.stringify(response),
    {
      headers: headers,
    },
  );
});
