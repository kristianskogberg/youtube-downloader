import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const outputFolder = process.cwd(); // Store files in the project root

// Helper function to convert time in "minute:second" format to seconds
const convertTimeToSeconds = (time: string): number => {
  const [minutes, seconds] = time.split(":").map(Number);
  return minutes * 60 + seconds;
};

export async function POST(req: Request) {
  const { videoUrl, startTime, endTime, format, quality } = await req.json();

  if (!videoUrl || startTime == null || !format || !quality) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  let status = "";
  let firstDownloadComplete = false;
  let lastProgressPercent = 0;
  let downloadStarted = false;
  let downloadPhases = 0;
  let currentDownloadPhase = 0;

  if (endTime !== undefined) {
    status = "1/2 - ";
  }

  console.log(
    `Starting download in ${format.toUpperCase()} format with ${quality} quality...`
  );

  const baseFilename = "input";
  const ytDlpOutput = path.join(outputFolder, `${baseFilename}.%(ext)s`);

  const formatSelection =
    format === "webm"
      ? "bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best"
      : format === "mp3"
      ? "bestaudio/best"
      : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best[ext=mp4]/best";

  return new Response(
    new ReadableStream({
      start(controller) {
        const ytDlp = spawn("yt-dlp", [
          "--no-playlist",
          "--extractor-retries",
          "3",
          "--fragment-retries",
          "3",
          "--retry-sleep",
          "1",
          "-f",
          formatSelection,
          "-o",
          ytDlpOutput,
          videoUrl,
        ]);

        ytDlp.stdout.on("data", (data) => {
          const log = data.toString();
          console.log(`yt-dlp: ${log}`);

          // Detect when a new download starts
          if (log.includes("[download] Destination:")) {
            downloadPhases++;
            console.log(`Detected download phase ${downloadPhases}`);
          }

          // Detect when current download completes and moves to next
          if (
            log.includes("100%") &&
            log.includes("[download]") &&
            !log.includes("frag")
          ) {
            currentDownloadPhase++;
            console.log(`Completed download phase ${currentDownloadPhase}`);
          }

          const progressMatch = log.match(/\[download\]\s+(\d+\.\d+)%/);
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]);

            // Check if this is a fragmented download
            const fragMatch = log.match(/\(frag (\d+)\/(\d+)\)/);

            if (fragMatch) {
              // For fragmented downloads, calculate overall progress based on fragments
              const currentFrag = parseInt(fragMatch[1]);
              const totalFrags = parseInt(fragMatch[2]);
              let fragmentProgress =
                ((currentFrag - 1) / totalFrags) * 100 + progress / totalFrags;

              // If we have multiple download phases (video + audio), adjust progress
              if (downloadPhases > 1) {
                const phaseProgress =
                  (currentDownloadPhase / downloadPhases) * 100;
                const currentPhaseProgress = fragmentProgress / downloadPhases;
                fragmentProgress = phaseProgress + currentPhaseProgress;
              }

              // Only send progress if it's higher than the last reported progress
              if (fragmentProgress > lastProgressPercent) {
                lastProgressPercent = fragmentProgress;
                console.log(
                  `Download progress: ${fragmentProgress.toFixed(
                    2
                  )}% (frag ${currentFrag}/${totalFrags}, phase ${
                    currentDownloadPhase + 1
                  }/${downloadPhases})`
                );

                controller.enqueue(
                  `data: ${JSON.stringify({
                    progress: `${status}Downloading ${fragmentProgress.toFixed(
                      2
                    )}%...`,
                  })}\n\n`
                );
              }
            } else {
              // For non-fragmented downloads, ignore initial 100% if download hasn't really started
              if (
                progress === 100 &&
                !downloadStarted &&
                lastProgressPercent === 0
              ) {
                // Skip initial false 100% reports
                return;
              }

              downloadStarted = true;

              // Calculate progress based on download phases
              let adjustedProgress = progress;
              if (downloadPhases > 1) {
                const phaseProgress =
                  (currentDownloadPhase / downloadPhases) * 100;
                const currentPhaseProgress = progress / downloadPhases;
                adjustedProgress = phaseProgress + currentPhaseProgress;
              }

              // Only send progress if it's higher than the last reported progress
              if (adjustedProgress > lastProgressPercent) {
                lastProgressPercent = adjustedProgress;
                console.log(
                  `Download progress: ${adjustedProgress.toFixed(2)}% (phase ${
                    currentDownloadPhase + 1
                  }/${downloadPhases})`
                );

                controller.enqueue(
                  `data: ${JSON.stringify({
                    progress: `${status}Downloading ${adjustedProgress.toFixed(
                      2
                    )}%...`,
                  })}\n\n`
                );
              }
            }
          }
        });

        ytDlp.stderr.on("data", (data) =>
          console.error(`yt-dlp error: ${data.toString()}`)
        );

        ytDlp.on("close", (code) => {
          if (code !== 0) {
            controller.enqueue(
              `data: ${JSON.stringify({
                error: "yt-dlp failed to download video",
              })}\n\n`
            );
            controller.close();
            return;
          }

          if (!firstDownloadComplete) {
            firstDownloadComplete = true;
          }

          console.log("Download complete. Checking for downloaded file...");
          controller.enqueue(
            `data: ${JSON.stringify({
              progress: `${status}Download complete, processing...`,
            })}\n\n`
          );

          const files = fs.readdirSync(outputFolder);
          const downloadedFile = files.find(
            (file) => file.startsWith(baseFilename) && !file.endsWith(".part")
          );

          if (!downloadedFile) {
            controller.enqueue(
              `data: ${JSON.stringify({
                error: "Downloaded video not found",
              })}\n\n`
            );
            controller.close();
            return;
          }

          const inputFile = path.join(outputFolder, downloadedFile);
          const outputFile = path.join(outputFolder, `output.${format}`);

          console.log(`Detected input file: ${inputFile}`);

          if (format === "mp3") {
            console.log(`Converting to MP3 format...`);
            const ffmpegArgs = [
              "-i",
              inputFile,
              "-q:a",
              "0",
              "-map",
              "a",
              outputFile,
            ];

            const ffmpeg = spawn("ffmpeg", ffmpegArgs);

            ffmpeg.stderr.on("data", (data) => {
              console.error(`ffmpeg error: ${data.toString()}`);
            });

            ffmpeg.on("close", (code) => {
              if (code !== 0) {
                controller.enqueue(
                  `data: ${JSON.stringify({
                    error: "FFmpeg processing failed",
                  })}\n\n`
                );
                controller.close();
                return;
              }

              console.log(
                `Processing complete! File ready for download: ${outputFile}`
              );

              try {
                fs.unlinkSync(inputFile);
                console.log(`Deleted input file: ${inputFile}`);
              } catch (err) {
                console.error(`Error deleting input file: ${err}`);
              }

              controller.enqueue(
                `data: ${JSON.stringify({
                  progress: `Processing complete!`,
                  downloadUrl: `/api/file/${format}`,
                })}\n\n`
              );
              controller.close();
            });
          } else {
            if (endTime === undefined) {
              console.log(
                `Skipping trimming. File ready for download: ${inputFile}`
              );
              fs.renameSync(inputFile, outputFile);
              controller.enqueue(
                `data: ${JSON.stringify({
                  progress: `Download complete`,
                  downloadUrl: `/api/file/${format}`,
                })}\n\n`
              );
              controller.close();
              return;
            }

            controller.enqueue(
              `data: ${JSON.stringify({
                progress: "Preparing to cut the video...",
              })}\n\n`
            );

            status = "2/2 - ";
            let lastCuttingProgress = 0;

            const startTimeMs = convertTimeToSeconds(startTime) * 1000;
            const endTimeMs = convertTimeToSeconds(endTime) * 1000;
            const durationMs = (endTimeMs - startTimeMs) * 1000;

            console.log(
              `startTimeMs: ${startTimeMs}, endTimeMs: ${endTimeMs}, durationMs: ${durationMs}`
            );

            const ffmpegArgs =
              format === "webm"
                ? [
                    "-i",
                    inputFile,
                    "-ss",
                    startTime,
                    "-to",
                    endTime,
                    "-c:v",
                    "libvpx-vp9",
                    "-b:v",
                    "4M",
                    "-crf",
                    "30",
                    "-c:a",
                    "libopus",
                    "-b:a",
                    "128k",
                    outputFile,
                    "-progress",
                    "pipe:1",
                  ]
                : [
                    "-i",
                    inputFile,
                    "-ss",
                    startTime,
                    "-to",
                    endTime,
                    "-c:v",
                    "libx264",
                    "-crf",
                    "18",
                    "-preset",
                    "slow",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    outputFile,
                    "-progress",
                    "pipe:1",
                  ];

            const ffmpeg = spawn("ffmpeg", ffmpegArgs);

            ffmpeg.stdout.on("data", (data) => {
              const log = data.toString();
              console.log(`ffmpeg: ${log}`);

              const progressMatch = log.match(/out_time_ms=(\d+)/);
              if (progressMatch) {
                const currentTimeMs = parseInt(progressMatch[1], 10);
                console.log(`currentTimeMs: ${currentTimeMs}`);
                const progressPercent = (currentTimeMs / durationMs) * 100;
                const progress = Math.min(Math.max(progressPercent, 0), 100);

                // Only send progress if it's higher than the last reported cutting progress
                if (progress > lastCuttingProgress) {
                  lastCuttingProgress = progress;
                  controller.enqueue(
                    `data: ${JSON.stringify({
                      progress: `${status}Cutting ${progress.toFixed(2)}%...`,
                    })}\n\n`
                  );
                }
              }

              if (log.includes("progress=end")) {
                controller.enqueue(
                  `data: ${JSON.stringify({
                    progress: "Complete",
                  })}\n\n`
                );
              }
            });

            ffmpeg.stderr.on("data", (data) => {
              console.error(`ffmpeg error: ${data.toString()}`);
            });

            ffmpeg.on("close", (code) => {
              if (code !== 0) {
                controller.enqueue(
                  `data: ${JSON.stringify({
                    error: "FFmpeg processing failed",
                  })}\n\n`
                );
                controller.close();
                return;
              }

              console.log(
                `Processing complete! File ready for download: ${outputFile}`
              );

              try {
                fs.unlinkSync(inputFile);
                console.log(`Deleted input file: ${inputFile}`);
              } catch (err) {
                console.error(`Error deleting input file: ${err}`);
              }

              controller.enqueue(
                `data: ${JSON.stringify({
                  progress: "Processing complete!",
                  downloadUrl: `/api/file/${format}`,
                })}\n\n`
              );
              controller.close();
            });
          }
        });
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
}
