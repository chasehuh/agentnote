import { describe, expect, it } from "vitest";
import {
  extractMarkdownImages,
  extractMarkdownVideos,
  parseVideoUrl,
} from "./media";

describe("parseVideoUrl", () => {
  it("maps YouTube watch / youtu.be / embed / shorts to nocookie embed", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });

  it("maps Vimeo numeric ids (site + player URLs)", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      kind: "vimeo",
      id: "123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789")).toEqual({
      kind: "vimeo",
      id: "123456789",
      embedUrl: "https://player.vimeo.com/video/123456789",
    });
  });

  it("accepts direct video files with querystrings", () => {
    expect(
      parseVideoUrl("https://cdn.example.com/clip.mp4?token=1"),
    ).toEqual({
      kind: "file",
      embedUrl: "https://cdn.example.com/clip.mp4?token=1",
    });
    expect(parseVideoUrl("https://cdn.example.com/a.webm#t=1")).toEqual({
      kind: "file",
      embedUrl: "https://cdn.example.com/a.webm#t=1",
    });
    expect(parseVideoUrl("https://cdn.example.com/a.ogg")).toEqual({
      kind: "file",
      embedUrl: "https://cdn.example.com/a.ogg",
    });
  });

  it("rejects non-http, non-allowlisted hosts, and non-video paths", () => {
    expect(parseVideoUrl("ftp://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://evil.com/embed/dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://example.com/a.png")).toBeNull();
    expect(parseVideoUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
    expect(parseVideoUrl("not a url")).toBeNull();
  });
});

describe("extractMarkdownVideos / image mutual exclusion", () => {
  it("extracts markdown-image form with width and bare own-line URLs", () => {
    const text = [
      "intro",
      "![talk|480](https://youtu.be/dQw4w9WgXcQ)",
      "https://vimeo.com/123456789",
      "![clip](https://cdn.example.com/a.mp4?x=1)",
      "https://cdn.example.com/b.webm",
    ].join("\n");

    const videos = extractMarkdownVideos(text);
    expect(videos.map((v) => v.kind)).toEqual([
      "youtube",
      "vimeo",
      "file",
      "file",
    ]);
    expect(videos[0]?.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videos[0]?.width).toBe(480);
    expect(videos[0]?.alt).toBe("talk");
    expect(videos[1]?.url).toBe("https://vimeo.com/123456789");
    expect(videos[2]?.kind).toBe("file");
  });

  it("keeps normal images as images and youtube markdown as video-only", () => {
    const text = [
      "![x](https://example.com/a.png)",
      "![y](https://youtu.be/dQw4w9WgXcQ)",
    ].join("\n");

    const images = extractMarkdownImages(text);
    expect(images).toHaveLength(1);
    expect(images[0]?.url).toBe("https://example.com/a.png");

    const videos = extractMarkdownVideos(text);
    expect(videos).toHaveLength(1);
    expect(videos[0]?.url).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(videos[0]?.kind).toBe("youtube");
  });

  it("does not treat in-paragraph URLs as bare embeds", () => {
    const text = "see https://youtu.be/dQw4w9WgXcQ please";
    expect(extractMarkdownVideos(text)).toEqual([]);
  });
});
