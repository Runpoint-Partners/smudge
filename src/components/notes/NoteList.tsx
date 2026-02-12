import { useCallback, useMemo, memo, useEffect, useRef, useState } from "react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { useNotes } from "../../context/NotesContext";
import {
  ListItem,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui";
import { cleanTitle } from "../../lib/utils";
import * as notesService from "../../services/notes";
import type { Settings } from "../../types/note";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();

  // Get start of today, yesterday, etc. (midnight local time)
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);

  // Today: show time
  if (date >= startOfToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // Yesterday
  if (date >= startOfYesterday) {
    return "Yesterday";
  }

  // Calculate days ago
  const daysAgo =
    Math.floor((startOfToday.getTime() - date.getTime()) / 86400000) + 1;

  // 2-6 days ago: show "X days ago"
  if (daysAgo <= 6) {
    return `${daysAgo} days ago`;
  }

  // This year: show month and day
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // Different year: show full date
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Memoized note item component
interface NoteItemProps {
  id: string;
  title: string;
  preview?: string;
  modified: number;
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

const NoteItem = memo(function NoteItem({
  id,
  title,
  preview,
  modified,
  isSelected,
  isPinned,
  onSelect,
  onContextMenu,
}: NoteItemProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => onSelect(id, e),
    [onSelect, id]
  );
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => onContextMenu(e, id),
    [onContextMenu, id]
  );

  return (
    <ListItem
      title={cleanTitle(title)}
      subtitle={preview}
      meta={formatDate(modified)}
      isSelected={isSelected}
      isPinned={isPinned}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  );
});

export function NoteList() {
  const {
    notes,
    selectedNoteId,
    selectNote,
    deleteNote,
    duplicateNote,
    pinNote,
    unpinNote,
    isLoading,
    searchQuery,
    searchResults,
  } = useNotes();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [notesToDelete, setNotesToDelete] = useState<string[]>([]);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectedIdRef = useRef<string | null>(null);

  // Load settings when notes change
  useEffect(() => {
    notesService
      .getSettings()
      .then(setSettings)
      .catch((error) => {
        console.error("Failed to load settings:", error);
      });
  }, [notes]);

  // Calculate pinned IDs set for efficient lookup
  const pinnedIds = useMemo(
    () => new Set(settings?.pinnedNoteIds || []),
    [settings]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (notesToDelete.length > 0) {
      try {
        for (const noteId of notesToDelete) {
          await deleteNote(noteId);
        }
        setNotesToDelete([]);
        setMultiSelectedIds(new Set());
        setDeleteDialogOpen(false);
      } catch (error) {
        console.error("Failed to delete note:", error);
      }
    }
  }, [notesToDelete, deleteNote]);

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, noteId: string) => {
      e.preventDefault();
      const isPinned = pinnedIds.has(noteId);
      const noteIdsForDelete =
        multiSelectedIds.size > 1 && multiSelectedIds.has(noteId)
          ? Array.from(multiSelectedIds)
          : [noteId];

      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: isPinned ? "Unpin" : "Pin",
            action: async () => {
              try {
                await (isPinned ? unpinNote(noteId) : pinNote(noteId));
                // Refresh settings after pin/unpin
                const newSettings = await notesService.getSettings();
                setSettings(newSettings);
              } catch (error) {
                console.error("Failed to pin/unpin note:", error);
              }
            },
          }),
          await MenuItem.new({
            text: "Duplicate",
            action: () => duplicateNote(noteId),
          }),
          await MenuItem.new({
            text: "Delete",
            action: () => {
              setNotesToDelete(noteIdsForDelete);
              setDeleteDialogOpen(true);
            },
          }),
        ],
      });

      await menu.popup();
    },
    [pinnedIds, pinNote, unpinNote, duplicateNote, multiSelectedIds]
  );

  // Memoize display items to prevent recalculation on every render
  const displayItems = useMemo(() => {
    if (searchQuery.trim()) {
      return searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        preview: r.preview,
        modified: r.modified,
      }));
    }
    return notes;
  }, [searchQuery, searchResults, notes]);

  const noteIdsInView = useMemo(
    () => new Set(displayItems.map((item) => item.id)),
    [displayItems]
  );

  // Keep multi-select set in sync when list/search results change.
  useEffect(() => {
    setMultiSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(Array.from(prev).filter((id) => noteIdsInView.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [noteIdsInView]);

  const queueDeleteSelection = useCallback(() => {
    const ids =
      multiSelectedIds.size > 0
        ? Array.from(multiSelectedIds)
        : selectedNoteId
          ? [selectedNoteId]
          : [];
    if (ids.length === 0) return;
    setNotesToDelete(ids);
    setDeleteDialogOpen(true);
  }, [multiSelectedIds, selectedNoteId]);

  const handleSelect = useCallback(
    (id: string, e: React.MouseEvent) => {
      containerRef.current?.focus();

      if (e.shiftKey) {
        const anchorId = lastSelectedIdRef.current ?? selectedNoteId ?? id;
        const anchorIndex = displayItems.findIndex((item) => item.id === anchorId);
        const targetIndex = displayItems.findIndex((item) => item.id === id);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] =
            anchorIndex < targetIndex
              ? [anchorIndex, targetIndex]
              : [targetIndex, anchorIndex];
          const rangeIds = displayItems.slice(start, end + 1).map((item) => item.id);
          setMultiSelectedIds(new Set(rangeIds));
          lastSelectedIdRef.current = id;
          void selectNote(id);
          return;
        }
      }

      if (e.metaKey || e.ctrlKey) {
        setMultiSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.size === 0 && selectedNoteId) {
            next.add(selectedNoteId);
          }
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        lastSelectedIdRef.current = id;
        void selectNote(id);
        return;
      }

      setMultiSelectedIds(new Set());
      lastSelectedIdRef.current = id;
      void selectNote(id);
    },
    [displayItems, selectNote, selectedNoteId]
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      queueDeleteSelection();
    },
    [queueDeleteSelection]
  );

  // Listen for focus request from editor (when Escape is pressed)
  useEffect(() => {
    const handleFocusNoteList = () => {
      containerRef.current?.focus();
    };

    window.addEventListener("focus-note-list", handleFocusNoteList);
    return () =>
      window.removeEventListener("focus-note-list", handleFocusNoteList);
  }, []);

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4 text-center text-text-muted select-none">
        Loading...
      </div>
    );
  }

  if (searchQuery.trim() && displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No results found
      </div>
    );
  }

  if (displayItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted select-none">
        No notes yet
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="flex flex-col gap-1 p-1.5 outline-none"
      >
        {displayItems.map((item) => (
          <NoteItem
            key={item.id}
            id={item.id}
            title={item.title}
            preview={item.preview}
            modified={item.modified}
            isSelected={selectedNoteId === item.id || multiSelectedIds.has(item.id)}
            isPinned={pinnedIds.has(item.id)}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {notesToDelete.length > 1 ? "Delete notes?" : "Delete note?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {notesToDelete.length > 1
                ? `This will permanently delete ${notesToDelete.length} notes and all their content. This action cannot be undone.`
                : "This will permanently delete the note and all its content. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
