"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { useVideoStore } from "../../store/videoStore";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

const VideoPreview = forwardRef((props, ref) => {
  const { videoUrl, startTime, setEndTime, setDuration } = useVideoStore();
  const playerRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => {
      return playerRef.current?.getCurrentTime() || 0;
    },
  }));

  useEffect(() => {
    // Load the YouTube Player API
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Initialize the player when the API is ready
    window.onYouTubeIframeAPIReady = () => {
      playerRef.current = new window.YT.Player(iframeRef.current, {
        videoId: getVideoId(videoUrl),
        events: {
          onReady: () => {
            if (startTime) {
              playerRef.current.seekTo(startTime);
            }
            const duration = playerRef.current.getDuration();
            setDuration(duration);
            setEndTime(duration);
          },
        },
      });
    };

    return () => {
      // Clean up
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    if (playerRef.current && startTime) {
      playerRef.current.seekTo(startTime);
    }
  }, [startTime]);

  const getVideoId = (url: string) => {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  };

  return (
    <div className="border-t border-gray-200 pt-6">
      <div
        className="relative pb-9/16 mb-4"
        style={{ paddingBottom: "56.25%" }}
      >
        <iframe
          ref={iframeRef}
          id="youtube-player"
          className="absolute top-0 left-0 w-full h-full"
          src={`https://www.youtube.com/embed/${getVideoId(
            videoUrl
          )}?enablejsapi=1`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        ></iframe>
      </div>
    </div>
  );
});

export default VideoPreview;
