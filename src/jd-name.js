/**
 * The name of a row's job-description file: jds/<company>-<role>.md.
 *
 * The name is derived, never stored, so the page can work out which file
 * belongs to a row without data.json carrying a path. Both sides have to
 * derive it the same way, so both load this one file: index.html as a
 * <script> (server.js serves it beside the page), and the job-from-url
 * scripts through require().
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JdName = factory();
})(typeof self !== "undefined" ? self : this, function () {
  /* Lower-case ASCII words joined by single hyphens, at most 80 characters,
     never starting or ending with a hyphen. Renée -> renee. */
  function jdSlug(s){
    return String(s == null ? "" : s)
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "");
  }

  /* The file's name without ".md"; empty when the row has neither half. */
  function jdName(company, roleTitle){
    return [jdSlug(company), jdSlug(roleTitle)].filter(Boolean).join("-");
  }

  return { jdSlug: jdSlug, jdName: jdName };
});
