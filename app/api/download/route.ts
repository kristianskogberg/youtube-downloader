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
      : "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[ext=mp4]";

  return new Response(
    new ReadableStream({
      start(controller) {
        const ytDlp = spawn("yt-dlp", [
          "--no-playlist",
          "-f",
          formatSelection,
          "-o",
          ytDlpOutput,
          videoUrl,
        ]);

        ytDlp.stdout.on("data", (data) => {
          const log = data.toString();
          console.log(`yt-dlp: ${log}`);

          const progressMatch = log.match(/\[download\]\s+(\d+\.\d+)%/);
          if (progressMatch) {
            const progress = parseFloat(progressMatch[1]).toFixed(2);
            if (progress === "100.00") firstDownloadComplete = true;
            if (firstDownloadComplete) {
              controller.enqueue(
                `data: ${JSON.stringify({
                  progress: `${status}Finishing...`,
                })}\n\n`
              );
            } else {
              controller.enqueue(
                `data: ${JSON.stringify({
                  progress: `${status}Downloading ${progress}%...`,
                })}\n\n`
              );
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
                const progress = Math.min(
                  Math.max(progressPercent, 0),
                  100
                ).toFixed(2);

                controller.enqueue(
                  `data: ${JSON.stringify({
                    progress: `${status}Cutting ${progress}%...`,
                  })}\n\n`
                );
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
