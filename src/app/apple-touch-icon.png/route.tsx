import { ImageResponse } from "next/og";
import { AppIconImage } from "@/lib/app-icon-image";

export const runtime = "edge";

export async function GET() {
  const size = 180;
  return new ImageResponse(<AppIconImage size={size} />, {
    width: size,
    height: size,
  });
}
