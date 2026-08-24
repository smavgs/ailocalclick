import { defineConfig } from "astro/config";

const owner = process.env.GITHUB_REPOSITORY_OWNER ?? "smavgs";
const repository = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "ailocalclick";
const isPagesBuild = process.env.GITHUB_ACTIONS === "true";
const base = process.env.PUBLIC_BASE_PATH ?? (isPagesBuild ? `/${repository}` : "/");

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? `https://${owner}.github.io`,
  base,
  output: "static",
  trailingSlash: "always",
  build: {
    format: "directory",
    inlineStylesheets: "auto"
  },
  vite: {
    build: {
      assetsInlineLimit: 2048
    }
  }
});
