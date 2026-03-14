"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { processDifyPipeline } from "./actions/dify";
import { Loader2, Upload, X, RefreshCw, Pause } from "lucide-react";

type ImageStatus = "pending" | "processing" | "completed" | "failed";

interface BatchImage {
  id: string;
  file: File;
  preview: string;
  status: ImageStatus;
  result?: Record<string, any>;
}

export default function BulkPage() {
  const [items, setItems] = useState<BatchImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const stopSignal = useRef(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newItems = Array.from(e.target.files).map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        file,
        preview: URL.createObjectURL(file),
        status: "pending" as ImageStatus,
      }));
      setItems((prev) => [...prev, ...newItems]);
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // NEW: Triggers the stop signal
  const pauseBatch = () => {
    stopSignal.current = true;
    setLogs((prev) => [`> SYSTEM: Pause requested. Halting after current image finishes...`, ...prev]);
  };

  const runBatch = async () => {
    setIsProcessing(true);
    stopSignal.current = false; // Reset signal on start/resume
    let consecutiveFailures = 0;
    const currentItems = [...items];

    for (let i = 0; i < currentItems.length; i++) {
      // NEW: Break the loop completely if user clicked Pause
      if (stopSignal.current) {
        setLogs((prev) => [`> SYSTEM: Pipeline paused successfully.`, ...prev]);
        break;
      }

      const current = currentItems[i];
      // Skip completed items, allowing "Resume" to work flawlessly
      if (!current || current.status === "completed") continue;

      current.status = "processing";
      setItems([...currentItems]);

      let attempt = 0;
      let success = false;

      while (attempt < 3 && !success) {
        try {
          const formData = new FormData();
          formData.append("file", current.file);
          formData.append("fileName", current.file.name);

          const res = await processDifyPipeline(formData);

          if (res.success) {
            current.status = "completed";
            current.result = res.analysis;
            success = true;
            consecutiveFailures = 0;
            setLogs(prev => [`DONE: ${current.file.name} (Run: ${res.runId})`, ...prev]);
          } else {
            attempt++;
            setLogs(prev => [`RETRY ${attempt}/3: ${current.file.name} - ${res.error}`, ...prev]);
          }
        } catch (err: any) {
          attempt++;
          setLogs(prev => [`ERROR: ${current.file.name} - ${err.message}`, ...prev]);
        }
      }

      if (!success) {
        current.status = "failed";
        consecutiveFailures++;
        setLogs(prev => [`FAILED: ${current.file.name}`, ...prev]);

        if (consecutiveFailures >= 2) {
          setLogs(prev => [`CRITICAL: Stopping pipeline due to consecutive failures.`, ...prev]);
          stopSignal.current = true;
        }
      }
      setItems([...currentItems]);
    }
    setIsProcessing(false);
  };

  const exportData = (type: "csv" | "json") => {
    const data = items.filter(i => i.result).map(i => i.result as Record<string, any>);
    if (data.length === 0) return;

    if (type === "csv") {
      const firstRow = data[0];
      if (!firstRow) return;
      const headers = Object.keys(firstRow).join(",");
      const rows = data.map(obj => Object.values(obj).map(val => `"${val}"`).join(","));
      const content = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
      window.open(encodeURI(content));
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `batch-${Date.now()}.json`;
      link.click();
    }
  };

  // Logic to determine what the start button should say
  const hasPendingItems = items.some(i => i.status === "pending" || i.status === "failed");
  const buttonText = items.length === 0 ? "Start Pipeline" : hasPendingItems && items.some(i => i.status === "completed") ? "Resume Pipeline" : "Start Pipeline";

  return (
    <div className="flex min-h-svh flex-col items-center p-6 bg-background text-foreground font-sans gap-8">
      
      {/* SECTION 1: CONTROLS */}
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center pb-4">
          <CardTitle className="font-black text-4xl italic uppercase tracking-tighter">TaTTTy Bulk Loader</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <label className="border-2 border-dashed border-border rounded-xl p-10 bg-muted/30 cursor-pointer hover:bg-muted/60 transition-colors flex flex-col items-center">
            <Upload className="w-10 h-10 mb-3 text-muted-foreground opacity-60" />
            <span className="font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Drop Images or Browse</span>
            <input type="file" multiple className="hidden" onChange={handleFileChange} />
          </label>

          <div className="flex gap-4">
            {/* NEW: Dynamic Pause / Resume Button Logic */}
            {isProcessing ? (
              <Button size="lg" variant="destructive" onClick={pauseBatch} className="flex-1 font-black uppercase italic shadow-sm">
                <Pause className="mr-2 w-4 h-4" /> Pause Pipeline
              </Button>
            ) : (
              <Button size="lg" onClick={runBatch} disabled={items.length === 0 || !hasPendingItems} className="flex-1 font-black uppercase italic shadow-sm">
                <RefreshCw className="mr-2 w-4 h-4" /> {buttonText}
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={() => { setItems([]); setLogs([]); }}>Clear All</Button>
          </div>

          <div className="flex gap-4 justify-center">
            <Button variant="secondary" onClick={() => exportData("csv")} disabled={!items.some(i => i.result)}>Export CSV</Button>
            <Button variant="secondary" onClick={() => exportData("json")} disabled={!items.some(i => i.result)}>Export JSON</Button>
          </div>
        </CardContent>
      </Card>

      {/* SECTION 2: SYSTEM LOGS */}
      <Card className="w-full max-w-4xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground italic text-center">System Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px] w-full rounded-md border bg-muted/10 p-4 font-mono text-[10px]">
            <div className="space-y-1.5">
              {logs.map((log, i) => (
                <div key={i} className={log.includes("DONE") ? "text-primary font-bold" : log.includes("FAILED") || log.includes("ERROR") || log.includes("CRITICAL") ? "text-destructive" : log.includes("PAUSE") ? "text-amber-500 font-bold" : "text-muted-foreground"}>
                  {log}
                </div>
              ))}
              {logs.length === 0 && <span className="opacity-50 italic tracking-widest text-muted-foreground">Awaiting batch ignite...</span>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* SECTION 3: QUEUE GALLERY */}
      <Card className="w-full max-w-5xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground italic text-center">Queue Gallery</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px] w-full pr-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((item) => (
                <Card key={item.id} className={`relative aspect-square overflow-hidden group ${
                  item.status === "processing" ? "border-primary animate-pulse" :
                  item.status === "completed" ? "border-primary/20 opacity-50" : "border-border"
                }`}>
                  <img src={item.preview} alt="batch-item" className="object-cover w-full h-full" />
                  
                  {item.status !== "processing" && item.status !== "completed" && (
                    <Button 
                      variant="destructive" 
                      size="icon" 
                      className="absolute top-2 right-2 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeItem(item.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                  
                  <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                    <Badge variant={item.status === "completed" ? "default" : item.status === "failed" ? "destructive" : "secondary"} className="text-[9px] uppercase font-black tracking-widest">
                      {item.status}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* SECTION 4: EXACT SHADCN KBD TOGGLE */}
      <div className="font-mono text-xs text-muted-foreground mt-4 pb-10">
        (Press <Kbd>d</Kbd> to toggle dark mode)
      </div>

    </div>
  );
}