import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;
export const runtime = "nodejs";

const SUPABASE_URL = 'https://ojmzqokffbptmcktnwdy.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbXpxb2tmZmJwdG1ja3Rud2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTAzNTYsImV4cCI6MjA5NDg4NjM1Nn0.e9sk4b_15ge2LIIQwFpXC3n_q48ctu9IJ6oJxV85kgw'

async function uploadToSupabase(supabase: any, buffer: Buffer, filename: string): Promise<string> {
  const { error } = await supabase.storage
    .from('swap-temp')
    .upload(filename, buffer, {
      contentType: 'image/jpeg',
      
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from('swap-temp').getPublicUrl(filename);
  return data.publicUrl;
}

export async function POST(request: NextRequest) {
  try {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return NextResponse.json({ error: "FAL_KEY non configure" }, { status: 500 });
    }

    fal.config({ credentials: FAL_KEY });

    const body = await request.json();
    const { source_image, target_image } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    const start = Date.now();

    const sourceB64 = source_image.includes(",") ? source_image.split(",")[1] : source_image;
    const targetB64 = target_image.includes(",") ? target_image.split(",")[1] : target_image;

    const sourceBuffer = Buffer.from(sourceB64, "base64");
    const targetBuffer = Buffer.from(targetB64, "base64");

    const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const ts = Date.now();
    const sourceFilename = `source_${ts}.jpg`;
    const targetFilename = `target_${ts}.jpg`;

    const [sourceUrl, targetUrl] = await Promise.all([
      uploadToSupabase(supabase, sourceBuffer, sourceFilename),
      uploadToSupabase(supabase, targetBuffer, targetFilename),
    ]);

    const result = await fal.subscribe("fal-ai/face-swap", {
      input: {
        base_image_url: sourceUrl,
        swap_image_url: targetUrl,
      },
    }) as any;

    Promise.all([
      supabase.storage.from('swap-temp').remove([sourceFilename]),
      supabase.storage.from('swap-temp').remove([targetFilename]),
    ]).catch(() => {});

    const imageUrl = result?.data?.image?.url || result?.image?.url;
    if (!imageUrl) {
      return NextResponse.json({ error: "Pas d'image dans la reponse", raw: JSON.stringify(result).slice(0, 300) }, { status: 500 });
    }

    const imgResponse = await fetch(imageUrl);
    const imgBuffer = await imgResponse.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      output_image: base64,
      processing_time: Date.now() - start,
    });
  } catch (error) {
    console.error("[FaceSwap API Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}