"use server"

type ProcessDifyResult = {
  success: boolean
  fileName: string
  runId?: string | null
  analysis?: Record<string, any>
  raw?: any
  error?: string
}

export async function processDifyPipeline(
  formData: FormData
): Promise<ProcessDifyResult> {
  const DIFY_API_KEY = process.env.DIFY_API_KEY
  const DYNAMIC_USER_ID = `user_${Date.now()}`

  const file = formData.get("file") as File | null
  const fileName =
    (formData.get("fileName") as string) || file?.name || "Unknown"

  if (!DIFY_API_KEY) {
    console.error("CRITICAL: DIFY_API_KEY is missing from .env")
    return { success: false, error: "API Key missing on server", fileName }
  }

  if (!file) {
    return {
      success: false,
      error: "No file received by server",
      fileName: "Unknown",
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 95_000)

  try {
    // 1) Upload file to Dify storage
    const difyFormData = new FormData()
    difyFormData.append("file", file)
    difyFormData.append("user", DYNAMIC_USER_ID)

    const uploadRes = await fetch("https://api.dify.ai/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DIFY_API_KEY}`,
      },
      body: difyFormData,
      signal: controller.signal,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      console.error("DIFY UPLOAD FAILED:", errText)
      throw new Error(`Upload failed: ${errText}`)
    }

    const uploadJson = await uploadRes.json()
    const fileId = uploadJson?.id

    if (!fileId) {
      console.error("DIFY UPLOAD RESPONSE MISSING ID:", uploadJson)
      throw new Error("Upload succeeded but no file ID was returned")
    }

    // 2) Run workflow in blocking mode
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
            type: "image",
          },
        },
        response_mode: "blocking",
        user: DYNAMIC_USER_ID,
      }),
      signal: controller.signal,
    })

    if (!workflowRes.ok) {
      const errText = await workflowRes.text()
      console.error("DIFY WORKFLOW FAILED:", errText)
      throw new Error(`Workflow failed: ${errText}`)
    }

    // 3) Blocking mode = parse JSON, not SSE
    const result = await workflowRes.json()
    console.log("DIFY WORKFLOW RESULT:", JSON.stringify(result, null, 2))

    const runId =
      result?.workflow_run_id ??
      result?.data?.workflow_run_id ??
      result?.data?.id ??
      null

    const status = result?.data?.status
    const outputs = result?.data?.outputs || {}
    const errorMessage = result?.data?.error || result?.error || null

    if (status === "failed") {
      throw new Error(errorMessage || "Workflow execution failed")
    }

    return {
      success: true,
      fileName,
      runId,
      analysis: outputs,
      raw: result,
    }
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? "Request timed out after 95 seconds"
        : err?.message || "Unknown server error"

    console.error("SERVER ACTION ERROR:", message)

    return {
      success: false,
      error: message,
      fileName,
    }
  } finally {
    clearTimeout(timeout)
  }
}
