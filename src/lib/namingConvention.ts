// Helper to parse ad names: e.g. CG_G6_MOFU_IBOBJECTION_VIDEO_NA_C012
export function parseNamingConvention(name: string) {
  const parts = name.split('_');
  if (parts.length >= 7) {
    return {
      campus: parts[0],             // CG
      grade: parts[1],              // G6
      funnelStage: parts[2],        // MOFU
      angle: parts[3],              // IBOBJECTION
      format: parts[4],             // VIDEO
      offer: parts[5],              // NA
      contentId: parts[6],          // C012
    };
  }
  return null;
}
