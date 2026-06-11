import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFaceSwapSync, checkJobStatus, submitFaceSwapJob } from "@/lib/runpod";

export const maxDuration = 60;

const POINTS_PER_FRAME = 2;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const { source_image, target_image, mode = "async" } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    const currentPoints = 999999;

    if (mode === "async") {
      const jobId = await submitFaceSwapJob({
        source_image,
        target_image,
        enhance_face: false,
        face_restore: false,
      });
      return NextResponse.json({
        success: true,
        job_id: jobId,
        points_remaining: currentPoints - POINTS_PER_FRAME,
      });
    } else {
      const result = await runFaceSwapSync({
        source_image,
        target_image,
        enhance_face: false,
        face_restore: false,
      });
      return NextResponse.json({
        success: true,
        output_image: result.output_image,
        processing_time: result.processing_time,
        points_remaining: currentPoints - POINTS_PER_FRAME,
      });
    }
  } catch (error) {
    console.error("[FaceSwap API Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("job_id");
    if (!jobId) {
      return NextResponse.json({ error: "job_id requis" }, { status: 400 });
    }

    const status = await checkJobStatus(jobId);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    console.error("[FaceSwap Status Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}