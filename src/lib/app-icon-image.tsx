type AppIconImageProps = {
  size: number;
};

export function AppIconImage({ size }: AppIconImageProps) {
  const cardWidth = Math.round(size * 0.59);
  const cardHeight = Math.round(size * 0.64);
  const cardRadius = Math.round(size * 0.14);
  const tabWidth = Math.round(size * 0.33);
  const tabHeight = Math.round(size * 0.12);
  const lineHeight = Math.round(size * 0.055);
  const badgeSize = Math.round(size * 0.32);
  const dotSize = Math.round(size * 0.078);

  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        borderRadius: Math.round(size * 0.235),
        background:
          "linear-gradient(140deg, #123D31 0%, #1F6B4F 55%, #2EA36E 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: Math.round(size * 0.08),
          borderRadius: Math.round(size * 0.2),
          background:
            "radial-gradient(circle at 28% 16%, rgba(255,255,255,0.26), rgba(255,255,255,0) 58%)",
        }}
      />
      <div
        style={{
          width: cardWidth,
          height: cardHeight,
          borderRadius: cardRadius,
          background: "#F7F4EC",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          alignItems: "flex-start",
          paddingTop: Math.round(size * 0.16),
          paddingLeft: Math.round(size * 0.1),
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -Math.round(size * 0.048),
            left: "50%",
            transform: "translateX(-50%)",
            width: tabWidth,
            height: tabHeight,
            borderRadius: Math.round(size * 0.06),
            background: "#15392E",
          }}
        />
        <div
          style={{
            width: Math.round(size * 0.29),
            height: lineHeight,
            borderRadius: Math.round(lineHeight / 2),
            background: "#214E3F",
            marginBottom: Math.round(size * 0.055),
          }}
        />
        <div
          style={{
            width: Math.round(size * 0.23),
            height: lineHeight,
            borderRadius: Math.round(lineHeight / 2),
            background: "rgba(33, 78, 63, 0.92)",
            marginBottom: Math.round(size * 0.055),
          }}
        />
        <div
          style={{
            width: Math.round(size * 0.19),
            height: lineHeight,
            borderRadius: Math.round(lineHeight / 2),
            background: "rgba(33, 78, 63, 0.82)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: Math.round(size * 0.145),
          bottom: Math.round(size * 0.16),
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeSize / 2,
          background: "linear-gradient(140deg, #7FEA5C 0%, #2EA36E 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: Math.round(size * 0.088),
            height: Math.round(size * 0.17),
            borderRight: `${Math.round(size * 0.028)}px solid #F8FBF4`,
            borderBottom: `${Math.round(size * 0.028)}px solid #F8FBF4`,
            transform: "rotate(45deg) translateY(-6%)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: Math.round(size * 0.23),
          right: Math.round(size * 0.2),
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          background: "#A7F36C",
        }}
      />
    </div>
  );
}
