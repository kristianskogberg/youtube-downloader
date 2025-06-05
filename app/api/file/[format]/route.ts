import { NextResponse, NextRequest } from "next/server";
import path from "path";
import fs from "fs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ format: string }> }
) {
  const reqparams = await params;
  const { format } = reqparams;
  const outputFile = path.join(process.cwd(), `output.${format}`);

  if (!fs.existsSync(outputFile)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  console.log(`Serving file: ${outputFile}`);

  // Create a readable stream from the file
  const fileStream = fs.createReadStream(outputFile);

  // Convert the Node.js ReadStream to a Web ReadableStream
  const readableStream = new ReadableStream({
    start(controller) {
      fileStream.on("data", (chunk) => controller.enqueue(chunk));
      fileStream.on("end", () => {
        controller.close();
        // Delete the file after it's fully streamed
        try {
          fs.unlinkSync(outputFile);
          console.log(`Deleted output file: ${outputFile}`);
        } catch (err) {
          console.error(`Error deleting output file: ${err}`);
        }
      });
      fileStream.on("error", (err) => controller.error(err));
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Disposition": `attachment; filename=output.${format}`,
      "Content-Type": format === "mp3" ? "audio/mpeg" : `video/${format}`,
    },
  });
}
