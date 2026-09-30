/**
 * Example: Using Enhanced Keystroke Tracker with Monaco Editor
 * Production-ready example component
 */

import React, { useRef, useEffect } from "react";
import { useEnhancedKeystrokeTracker } from "@/hooks/useEnhancedKeystrokeTracker";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import MonacoEditor from "@monaco-editor/react";

interface CodeEditorProps {
  testId: string;
  initialCode?: string;
  onSave?: (code: string) => Promise<void>;
}

export function CodeEditorWithTracking({ testId, initialCode = "", onSave }: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const { user } = useSupabaseAuth();
  const [code, setCode] = React.useState(initialCode);
  const [isSaving, setIsSaving] = React.useState(false);
  const [bufferSize, setBufferSize] = React.useState(0);

  // Initialize keystroke tracker
  const keystrokeTracker = useEnhancedKeystrokeTracker({
    userId: user?.id || null,
    testId,
    editorRef,
    enabled: true,
    batchSize: 10, // Flush after 10 keystrokes
    flushInterval: 5000, // Or every 5 seconds
    onError: (error) => {
      console.error("Keystroke tracking error:", error);
      // Show toast notification
    },
  });

  // Update buffer size display
  useEffect(() => {
    const interval = setInterval(() => {
      setBufferSize(keystrokeTracker.getBufferSize());
    }, 500);
    return () => clearInterval(interval);
  }, [keystrokeTracker]);

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
    console.log("[CodeEditor] Editor mounted");
  };

  const handleCodeChange = (newCode: string | undefined) => {
    setCode(newCode || "");
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);

      // Flush pending keystrokes first
      await keystrokeTracker.flush();

      // Save code
      if (onSave) {
        await onSave(code);
      }

      console.log("[CodeEditor] ✅ Code saved successfully");
    } catch (error) {
      console.error("[CodeEditor] Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewRetryQueue = () => {
    const status = keystrokeTracker.getRetryQueueStatus();
    console.log("[CodeEditor] Retry queue status:", status);
    alert(JSON.stringify(status, null, 2));
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Code Editor</h2>
          <p className="text-sm text-gray-400">
            User: {user?.email || "Not authenticated"} | Test: {testId}
          </p>
        </div>

        {/* Status Bar */}
        <div className="flex items-center gap-4">
          <div className="text-sm">
            <span className="text-yellow-400">Buffer: {bufferSize}</span> keystrokes pending
          </div>
          <button
            onClick={handleViewRetryQueue}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-sm rounded"
          >
            View Queue
          </button>
          <button
            onClick={() => keystrokeTracker.flush()}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-sm rounded"
          >
            Flush Now
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded font-medium"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          language="python"
          value={code}
          onChange={handleCodeChange}
          onMount={handleEditorMount}
          options={{
            theme: "vs-dark",
            minimap: { enabled: true },
            fontSize: 14,
            fontFamily: "'Fira Code', monospace",
            formatOnPaste: true,
            automaticLayout: true,
          }}
        />
      </div>

      {/* Footer */}
      <div className="bg-gray-800 p-2 border-t border-gray-700 text-xs text-gray-400">
        <p>Keystroke tracking active • All keystrokes are being recorded and analyzed</p>
      </div>
    </div>
  );
}

export default CodeEditorWithTracking;
