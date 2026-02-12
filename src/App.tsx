import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { NotesProvider, useNotes } from "./context/NotesContext";
import { ThemeProvider } from "./context/ThemeContext";
import { GitProvider } from "./context/GitContext";
import { TooltipProvider, Toaster } from "./components/ui";
import { Sidebar } from "./components/layout/Sidebar";
import { Editor } from "./components/editor/Editor";
import { FolderPicker } from "./components/layout/FolderPicker";
import { CommandPalette } from "./components/command-palette/CommandPalette";
import { SettingsPage } from "./components/settings";
import { SpinnerIcon, ClaudeIcon } from "./components/icons";
import { AiEditModal } from "./components/ai/AiEditModal";
import { AiResponseToast } from "./components/ai/AiResponseToast";
import {
  check as checkForUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";
import * as aiService from "./services/ai";

type ViewState = "notes" | "settings";
const LAST_EXTERNAL_FILE_SESSION_KEY = "smudge:last-external-file-path";

function AppContent() {
  const {
    notesFolder,
    isLoading,
    createNote,
    notes,
    selectedNoteId,
    selectNote,
    searchQuery,
    searchResults,
    reloadCurrentNote,
    currentNote,
    externalFile,
    openExternalFile,
  } = useNotes();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<ViewState>("notes");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiEditing, setAiEditing] = useState(false);
  const openedFileProbeTimersRef = useRef<number[]>([]);

  const persistExternalFilePath = useCallback((path: string | null) => {
    try {
      if (path) {
        window.sessionStorage.setItem(LAST_EXTERNAL_FILE_SESSION_KEY, path);
      } else {
        window.sessionStorage.removeItem(LAST_EXTERNAL_FILE_SESSION_KEY);
      }
    } catch {
      // Ignore storage errors (e.g. disabled storage in unusual environments)
    }
  }, []);

  const readPersistedExternalFilePath = useCallback(() => {
    try {
      return window.sessionStorage.getItem(LAST_EXTERNAL_FILE_SESSION_KEY);
    } catch {
      return null;
    }
  }, []);

  // Check for files opened via OS file association (cold start + warm start signal)
  const checkOpenedFiles = useCallback(async () => {
    try {
      const files = await invoke<string[]>("get_opened_files");
      const markdownFiles = files.filter((path) =>
        /\.(md|markdown|mdown|mkd)$/i.test(path),
      );
      if (markdownFiles.length > 0) {
        // Prefer the latest opened file if multiple were queued.
        const filePath = markdownFiles[markdownFiles.length - 1];
        persistExternalFilePath(filePath);
        await openExternalFile(filePath);
      }
    } catch (err) {
      console.error("Failed to check opened files:", err);
    }
  }, [openExternalFile, persistExternalFilePath]);

  // Cold start: check for buffered files and mark frontend ready
  useEffect(() => {
    async function init() {
      const persistedFilePath = readPersistedExternalFilePath();
      if (persistedFilePath) {
        await openExternalFile(persistedFilePath);
      }
      await checkOpenedFiles();
      await invoke("mark_frontend_ready");
    }
    init();
  }, [checkOpenedFiles, openExternalFile, readPersistedExternalFilePath]);

  // Warm start: listen for file-opened signal from backend, then poll for files
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<string>("file-opened", () => {
      checkOpenedFiles();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [checkOpenedFiles]);

  // Fallback for missed warm-start signals:
  // when the app becomes focused/visible, poll backend's buffered opened files.
  useEffect(() => {
    const clearProbeTimers = () => {
      for (const timer of openedFileProbeTimersRef.current) {
        clearTimeout(timer);
      }
      openedFileProbeTimersRef.current = [];
    };

    const probeOpenedFiles = () => {
      clearProbeTimers();
      // Probe several times because macOS focus and Opened events can arrive
      // in either order when opening files into an already-running app.
      const delays = [0, 150, 400, 900, 1500];
      for (const delay of delays) {
        const timer = window.setTimeout(() => {
          checkOpenedFiles();
        }, delay);
        openedFileProbeTimersRef.current.push(timer);
      }
    };

    const handleFocus = () => {
      probeOpenedFiles();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        probeOpenedFiles();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearProbeTimers();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkOpenedFiles]);

  // Last-resort fallback: periodically poll backend's opened-file buffer.
  // This guarantees OS-opened files are eventually picked up even if signals
  // or focus ordering fail on some macOS flows.
  useEffect(() => {
    const interval = window.setInterval(() => {
      checkOpenedFiles();
    }, 1500);
    return () => {
      clearInterval(interval);
    };
  }, [checkOpenedFiles]);

  // Drag-and-drop: open .md files dropped onto the app window
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const mdFile = event.payload.paths.find((p) =>
            /\.(md|markdown|mdown|mkd)$/i.test(p),
          );
          if (mdFile) {
            openExternalFile(mdFile);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [openExternalFile]);

  // Keep the session cache in sync so external files survive remounts in dev.
  useEffect(() => {
    persistExternalFilePath(externalFile?.path ?? null);
  }, [externalFile?.path, persistExternalFilePath]);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((prev) => !prev);
  }, []);

  const toggleSettings = useCallback(() => {
    setView((prev) => (prev === "settings" ? "notes" : "settings"));
  }, []);

  const closeSettings = useCallback(() => {
    setView("notes");
  }, []);

  // Go back to command palette from AI modal
  const handleBackToPalette = useCallback(() => {
    setAiModalOpen(false);
    setPaletteOpen(true);
  }, []);

  // AI Edit handler
  const handleAiEdit = useCallback(
    async (prompt: string) => {
      if (!currentNote) {
        toast.error("No note selected");
        return;
      }

      setAiEditing(true);

      try {
        // Execute Claude CLI on current file
        const result = await aiService.executeClaudeEdit(
          currentNote.path,
          prompt,
        );

        // Reload the current note from disk
        await reloadCurrentNote();

        // Show results
        if (result.success) {
          // Close modal after success
          setAiModalOpen(false);

          // Show success toast with Claude's response
          toast(<AiResponseToast output={result.output} />, {
            duration: Infinity,
            closeButton: true,
            className: "!min-w-[450px] !max-w-[600px]",
          });
        } else {
          toast.error(
            <div className="space-y-1">
              <div className="font-medium">AI Edit Failed</div>
              <div className="text-xs">{result.error || "Unknown error"}</div>
            </div>,
            { duration: Infinity, closeButton: true },
          );
        }
      } catch (error) {
        console.error("[AI] Error:", error);
        toast.error(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        setAiEditing(false);
      }
    },
    [currentNote, reloadCurrentNote],
  );

  // Memoize display items to prevent unnecessary recalculations
  const displayItems = useMemo(() => {
    return searchQuery.trim() ? searchResults : notes;
  }, [searchQuery, searchResults, notes]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInEditor = target.closest(".ProseMirror");
      const isInInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Cmd+, - Toggle settings (always works, even in settings)
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
        return;
      }

      // Block all other shortcuts when in settings view
      if (view === "settings") {
        return;
      }

      // Trap Tab/Shift+Tab in notes view only - prevent focus navigation
      // TipTap handles indentation internally before event bubbles up
      if (e.key === "Tab") {
        e.preventDefault();
        return;
      }

      // Cmd+P - Open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Cmd+\ - Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N - New note
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        createNote();
        return;
      }

      // Cmd+R - Reload current note (pull external changes)
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        reloadCurrentNote();
        return;
      }

      // Arrow keys for note navigation (when not in editor or input)
      if (!isInEditor && !isInInput && displayItems.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const currentIndex = displayItems.findIndex(
            (n) => n.id === selectedNoteId,
          );
          let newIndex: number;

          if (e.key === "ArrowDown") {
            newIndex =
              currentIndex < displayItems.length - 1 ? currentIndex + 1 : 0;
          } else {
            newIndex =
              currentIndex > 0 ? currentIndex - 1 : displayItems.length - 1;
          }

          selectNote(displayItems[newIndex].id);
          return;
        }

        // Enter to focus editor
        if (e.key === "Enter" && selectedNoteId) {
          e.preventDefault();
          const editor = document.querySelector(".ProseMirror") as HTMLElement;
          if (editor) {
            editor.focus();
          }
          return;
        }
      }

      // Escape to blur editor and go back to note list
      if (e.key === "Escape" && isInEditor) {
        e.preventDefault();
        (target as HTMLElement).blur();
        // Focus the note list for keyboard navigation
        window.dispatchEvent(new CustomEvent("focus-note-list"));
        return;
      }
    };

    // Disable right-click context menu except in editor
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Allow context menu in editor (prose class) and inputs
      const isInEditor =
        target.closest(".prose") || target.closest(".ProseMirror");
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (!isInEditor && !isInput) {
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [
    createNote,
    displayItems,
    reloadCurrentNote,
    selectedNoteId,
    selectNote,
    toggleSettings,
    toggleSidebar,
    view,
  ]);

  const handleClosePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-text-muted/70 text-sm flex items-center gap-1.5 font-medium">
          <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
          Initializing Smudge...
        </div>
      </div>
    );
  }

  if (!notesFolder && !externalFile) {
    return <FolderPicker />;
  }

  return (
    <>
      <div className="h-screen flex bg-bg overflow-hidden">
        {view === "settings" ? (
          <SettingsPage onBack={closeSettings} />
        ) : externalFile ? (
          <>
            {notesFolder && sidebarVisible && (
              <Sidebar onOpenSettings={toggleSettings} />
            )}
            <Editor
              onToggleSidebar={notesFolder ? toggleSidebar : undefined}
              sidebarVisible={notesFolder ? sidebarVisible : false}
            />
          </>
        ) : (
          <>
            {sidebarVisible && <Sidebar onOpenSettings={toggleSettings} />}
            <Editor
              onToggleSidebar={toggleSidebar}
              sidebarVisible={sidebarVisible}
            />
          </>
        )}
      </div>

      {/* Shared backdrop for command palette and AI modal */}
      {(paletteOpen || aiModalOpen) && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => {
            if (paletteOpen) handleClosePalette();
            if (aiModalOpen) setAiModalOpen(false);
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={handleClosePalette}
        onOpenSettings={toggleSettings}
        onOpenAiModal={() => setAiModalOpen(true)}
      />
      <AiEditModal
        open={aiModalOpen}
        onBack={handleBackToPalette}
        onExecute={handleAiEdit}
        isExecuting={aiEditing}
      />

      {/* AI Editing Overlay */}
      {aiEditing && (
        <div className="fixed inset-0 bg-bg/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <ClaudeIcon className="w-4.5 h-4.5 fill-text-muted animate-spin-slow" />
            <div className="text-sm font-medium text-text">
              Claude is editing your note...
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Shared update check — used by startup and manual "Check for Updates"
async function showUpdateToast(): Promise<"update" | "no-update" | "error"> {
  try {
    const update = await checkForUpdate();
    if (update) {
      toast(<UpdateToast update={update} toastId="update-toast" />, {
        id: "update-toast",
        duration: Infinity,
        closeButton: true,
      });
      return "update";
    }
    return "no-update";
  } catch (err) {
    // Network errors and 404s (no release published yet) are not real failures
    const msg = String(err);
    if (
      msg.includes("404") ||
      msg.includes("network") ||
      msg.includes("Could not fetch")
    ) {
      return "no-update";
    }
    console.error("Update check failed:", err);
    return "error";
  }
}

export { showUpdateToast };

function UpdateToast({
  update,
  toastId,
}: {
  update: Update;
  toastId: string | number;
}) {
  const [installing, setInstalling] = useState(false);

  const handleUpdate = async () => {
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      toast.dismiss(toastId);
      toast.success("Update installed! Restart Smudge to apply.", {
        duration: Infinity,
        closeButton: true,
      });
    } catch (err) {
      console.error("Update failed:", err);
      toast.error("Update failed. Please try again later.");
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="font-medium text-sm">
        Update Available: v{update.version}
      </div>
      {update.body && (
        <div className="text-xs text-text-muted line-clamp-3">
          {update.body}
        </div>
      )}
      <button
        onClick={handleUpdate}
        disabled={installing}
        className="self-start mt-1 text-xs font-medium px-3 py-1.5 rounded-md bg-text text-bg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {installing ? "Installing..." : "Update Now"}
      </button>
    </div>
  );
}

function App() {
  // Add platform class for OS-specific styling (e.g., keyboard shortcuts)
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    document.documentElement.classList.add(
      isMac ? "platform-mac" : "platform-other",
    );
  }, []);

  // Check for app updates on startup
  useEffect(() => {
    const timer = setTimeout(() => showUpdateToast(), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ThemeProvider>
      <Toaster />
      <TooltipProvider>
        <NotesProvider>
          <GitProvider>
            <AppContent />
          </GitProvider>
        </NotesProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
