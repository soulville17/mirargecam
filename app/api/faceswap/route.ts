import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFaceSwapSync, submitFaceSwapJob, checkJobStatus } from "@/lib/runpod";

// Points cost: 2 points = 1 second of swap
const POINTS_PER_FRAME = 2;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Non autorise" },
        { status: 401 }
      );
    }

    // Get request body
    const body = await request.json();
    const { source_image, target_image, mode = "sync" } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    // MODE TEST — points illimités (désactiver en production)
    const TEST_MODE = true
    let currentPoints = 999999

    if (!TEST_MODE) {
      const { data: subscription, error: subError } = await supabase
        .from("subscriptions")
        .select("points")
        .eq("user_id", user.id)
        .single();

      if (subError || !subscription) {
        return NextResponse.json({ error: "Abonnement non trouve" }, { status: 404 });
      }

      currentPoints = subscription.points ?? 0

      if (currentPoints < POINTS_PER_FRAME) {
        return NextResponse.json(
          { error: "Points insuffisants", points_required: POINTS_PER_FRAME, points_available: currentPoints },
          { status: 402 }
        );
      }

      await supabase
        .from("subscriptions")
        .update({ points: currentPoints - POINTS_PER_FRAME })
        .eq("user_id", user.id);
    }

    if (mode === "async") {
      // Async mode - return job ID immediately
      const jobId = await submitFaceSwapJob({
        source_image,
        target_image,
        enhance_face: true,
        face_restore: true,
      });

      return NextResponse.json({
        success: true,
        job_id: jobId,
        points_remaining: profile.points - POINTS_PER_FRAME,
      });
    } else {
      // Sync mode - wait for result
      const result = await runFaceSwapSync({
        source_image,
        target_image,
        enhance_face: true,
        face_restore: true,
      });

      // Update transaction status
      await supabase
        .from("swap_transactions")
        .update({ status: "completed" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      return NextResponse.json({
        success: true,
        output_image: result.output_image,
        processing_time: result.processing_time,
        points_remaining: profile.points - POINTS_PER_FRAME,
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

// Check job status
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: "Non autorise" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("job_id");

    if (!jobId) {
      return NextResponse.json(
        { error: "job_id est requis" },
        { status: 400 }
      );
    }

    const status = await checkJobStatus(jobId);

    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("[FaceSwap Status Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
