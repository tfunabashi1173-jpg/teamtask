import { ImageResponse } from "next/og";
import { AppIconImage } from "@/lib/app-icon-image";


export async function GET() {
  const size = 512;
  return new ImageResponse(<AppIconImage size={size} />, {
    width: size,
    height: size,
  });
}
