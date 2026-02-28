import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "p",
  "a",
  "code",
  "pre",
  "i",
  "em",
  "b",
  "strong",
  "blockquote",
  "ul",
  "ol",
  "li",
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}
