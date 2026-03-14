"use server";

export async function processDifyPipeline(formData: FormData) {
  const DIFY_API_KEY = process.env.DIFY_API_KEY;
  const DYNAMIC_USER_ID = `user_${Date.now()}`;
  const DYNAMIC_RUN_ID = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const file = formData.get("file") as File;
  const fileName = formData.get("fileName") as string;

  if (!DIFY_API_KEY) {
    console.error("CRITICAL: DIFY_API_KEY is missing from .env");
    return { success: false, error: "API Key missing on server", fileName };
  }

  if (!file) {
    return { success: false, error: "No file received by server", fileName: "Unknown" };
  }

  try {
    // 1. Pack the file for Dify Upload
    const difyFormData = new FormData();
    difyFormData.append("file", file);
    difyFormData.append("user", DYNAMIC_USER_ID);

    // 2. Upload to Dify Storage
    const uploadRes = await fetch("https://api.dify.ai/v1/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${DIFY_API_KEY}` },
      body: difyFormData,
    });
    
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("DIFY UPLOAD FAILED:", errText);
      throw new Error(`Upload Reject: ${errText}`);
    }
    const { id: fileId } = await uploadRes.json();

    // 3. Trigger Dify Workflow in STREAMING Mode
    const workflowRes = await fetch("https://api.dify.ai/v1/workflows/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DIFY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: { 
          image_ex: { 
            transfer_method: "local_file", 
            upload_file_id: fileId, 
            type: "image" 
          } 
        },
        workflow_run_id: DYNAMIC_RUN_ID,
        response_mode: "streaming", // SWITCHED TO STREAMING
        user: DYNAMIC_USER_ID,
      }),
    });

    if (!workflowRes.ok) {
      const errData = await workflowRes.text();
      console.error("DIFY WORKFLOW FAILED:", errData);
      throw new Error("Workflow Execution Failed");
    }

    if (!workflowRes.body) {
      throw new Error("No stream body returned from Dify");
    }

    // 4. Consume the SSE Stream to bypass Cloudflare Timeouts
    const reader = workflowRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
    
    let isFinished = false;
    let finalAnalysis = {};
    let buffer = "";

    while (!isFinished) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode stream chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // SSE chunks are separated by double newlines
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2); // Remove processed chunk from buffer
        boundary = buffer.indexOf("\n\n");

        console.log("STREAM CHUNK ARRIVED:", chunk.substring(0, 150));

        if (chunk.startsWith("data: ")) {
          const dataStr = chunk.replace("data: ", "").trim();
          
          // Skip empty keep-alive ping events
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const parsedData = JSON.parse(dataStr);

            // Listen specifically for the end of the workflow
            if (parsedData.event === "workflow_finished") {
              if (parsedData.data.status === "succeeded") {
                finalAnalysis = parsedData.data.outputs || {};
              } else {
                throw new Error(parsedData.data.error || "Workflow finished with failed status");
              }
              isFinished = true;
            }
          } catch (e: any) {
             // Ignore partial chunk parse errors
             if (e.message !== "Workflow finished with failed status") {
                 continue;
             } else {
                 throw e;
             }
          }
        }
      }
    }

    return { 
      success: true, 
      fileName, 
      runId: DYNAMIC_RUN_ID, 
      analysis: finalAnalysis 
    };

  } catch (err: any) {
    console.error("SERVER ACTION ERROR:", err.message);
    return { success: false, error: err.message, fileName };
  }
}