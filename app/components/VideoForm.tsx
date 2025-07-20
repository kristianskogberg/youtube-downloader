"use client";

import type React from "react";
import { useState, useRef } from "react";
import VideoPreview from "./VideoPreview";
import { useVideoStore } from "../../store/videoStore";
import { FiDownload } from "react-icons/fi";
import { MdOutlineSearch } from "react-icons/md";
import { FiEdit } from "react-icons/fi";

const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? "0" : ""}${minutes}:${
      remainingSeconds < 10 ? "0" : ""
    }${remainingSeconds}`;
  } else {
    return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
  }
};

const parseTime = (time: string) => {
  const [minutes, seconds] = time.split(":").map(Number);
  return minutes * 60 + seconds;
};

export default function VideoForm() {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [editMode, setEditMode] = useState(false);

  const {
    videoUrl,
    startTime,
    endTime,
    format,
    quality,
    setVideoUrl,
    setStartTime,
    setEndTime,
    setFormat,
  } = useVideoStore();
  const videoPreviewRef = useRef<any>(null);

  const isYouTubeUrl = async (url: string) => {
    const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;
    if (!pattern.test(url)) return false;

    console.log(url);

    try {
      const videoId = extractVideoId(url);
      if (!videoId) return false;

      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );

      console.log(response);

      return response.ok;
    } catch (error) {
      return false;
    }
  };

  const extractVideoId = (url: string) => {
    const regex =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const handleUrlChange = async (value: string) => {
    setInput(value);
    setError("");

    const isValid = await isYouTubeUrl(value);
    if (isValid) {
      setVideoUrl(value);
    } else if (value) {
      setError("Please enter a valid YouTube URL or the video may not exist.");
    }
  };

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedUrl = e.clipboardData.getData("text");
    handleUrlChange(pastedUrl);
  };

  const handleSetStartTime = () => {
    const currentTime = videoPreviewRef.current?.getCurrentTime() || 0;
    setStartTime(currentTime);
  };

  const handleSetEndTime = () => {
    const currentTime = videoPreviewRef.current?.getCurrentTime() || 0;
    setEndTime(currentTime);
  };

  function handleReset() {
    setInput("");
    setVideoUrl("");
    setStartTime(0);
    setEndTime(0);
    setProgress("");
    setProgressPercent(0);
  }

  async function downloadVideo() {
    setProgress("Starting download...");
    setProgressPercent(0);

    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl,
        startTime: editMode ? formatTime(startTime) : "0:00",
        endTime: editMode ? formatTime(endTime) : undefined,
        format,
        quality,
      }),
    });

    if (!response.body) {
      setProgress("Failed to start download.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let downloadUrl = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const progressUpdates = text
        .split("\n")
        .filter((line) => line.trim() !== "");

      progressUpdates.forEach((update) => {
        try {
          const json = JSON.parse(update.replace("data: ", "").trim());
          if (json.progress) {
            setProgress(json.progress);

            // Extract percentage from progress string
            const percentMatch = json.progress.match(/(\d+\.?\d*)%/);
            if (percentMatch) {
              const percent = parseFloat(percentMatch[1]);
              setProgressPercent(percent);
            } else if (
              json.progress.includes("complete") ||
              json.progress.includes("Complete")
            ) {
              setProgressPercent(100);
            }
          }
          if (json.downloadUrl) {
            downloadUrl = json.downloadUrl;
          }
        } catch (error) {
          console.error("Error parsing progress:", error);
        }
      });
    }

    if (downloadUrl) {
      setProgress("Download complete!");
      setProgressPercent(100);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `video.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      setProgress("Failed to download video.");
      setProgressPercent(0);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          {videoUrl === "" ? (
            <>
              <label
                htmlFor="video-url"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                YouTube Video URL
              </label>
              <input
                id="video-url"
                type="url"
                value={input}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full px-3 py-2 border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onChange={(e) => handleUrlChange(e.target.value)}
                onPaste={handleUrlPaste}
              />
              {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
            </>
          ) : (
            <div className="flex items-center justify-start">
              <button onClick={handleReset}>
                <MdOutlineSearch size={22} className="inline-block mr-1" /> Back
                to Search...
              </button>
            </div>
          )}
        </div>
      </form>

      {videoUrl && (
        <>
          <VideoPreview ref={videoPreviewRef} />
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setEditMode(!editMode)}
              className="flex justify-center items-center px-4 py-2 bg-gray-600 text-white  hover:bg-gray-700 "
            >
              <FiEdit className="inline-block mr-2" />{" "}
              {editMode ? "Disable Edit Mode" : "Enable Edit Mode"}
            </button>
          </div>
          <div className="space-y-4">
            {editMode && (
              <div className="flex space-x-4">
                <div className="flex-1">
                  <label
                    htmlFor="start-time"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Start Time (mm:ss)
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      id="start-time"
                      type="text"
                      value={formatTime(startTime)}
                      onChange={(e) => setStartTime(parseTime(e.target.value))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSetStartTime}
                      className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      Set
                    </button>
                  </div>
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="end-time"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    End Time (mm:ss)
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      id="end-time"
                      type="text"
                      value={formatTime(endTime)}
                      onChange={(e) => setEndTime(parseTime(e.target.value))}
                      required
                      className="w-full px-3 py-2 border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSetEndTime}
                      className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex space-x-4 items-end">
              <div className="flex-1">
                <label
                  htmlFor="format"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Format
                </label>
                <select
                  id="format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300  shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="mp4">MP4</option>
                  <option value="webm">WebM</option>
                  <option value="mp3">MP3</option>
                </select>
              </div>
              <div className="flex-1">
                <button
                  onClick={downloadVideo}
                  className="flex items-center justify-center w-full px-4 py-2 bg-slate-700 text-white  hover:bg-slate-800"
                >
                  <FiDownload size={20} className="inline-block mr-2" />
                  Download
                </button>
              </div>
            </div>
          </div>
          {progress && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-blue-600 font-medium">{progress}</p>
                <span className="text-sm text-gray-500">
                  {progressPercent.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                ></div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
