import { create } from "zustand";

interface VideoState {
  videoUrl: string;
  startTime: number;
  endTime: number;
  duration: number;
  format: "mp4" | "webm" | "mp3";
  quality: string;
  setVideoUrl: (url: string) => void;
  setStartTime: (time: number) => void;
  setEndTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setFormat: (format: string) => void;
  setQuality: (quality: string) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  videoUrl: "",
  startTime: 0,
  endTime: 0,
  duration: 0,
  format: "mp4",
  quality: "1080p",
  setVideoUrl: (url) => set({ videoUrl: url }),
  setStartTime: (time) =>
    set((state) => {
      const newEndTime = time >= state.endTime ? time + 30 : state.endTime;
      return {
        startTime: time,
        endTime: newEndTime > state.duration ? state.duration : newEndTime,
      };
    }),
  setEndTime: (time) =>
    set((state) => ({
      endTime: time > state.duration ? state.duration : time,
      startTime: state.startTime >= time ? time - 30 : state.startTime,
    })),
  setDuration: (duration) => set({ duration }),
  setFormat: (format) => {
    const validFormats: VideoState["format"][] = ["mp4", "webm", "mp3"];
    if (validFormats.includes(format as VideoState["format"])) {
      set({ format: format as VideoState["format"] });
    } else {
      console.warn(
        `Invalid format: ${format}. Allowed formats are mp4, webm, and mp3.`
      );
    }
  },
  setQuality: (quality) => set({ quality }),
}));
