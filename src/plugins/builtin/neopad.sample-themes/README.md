# Nebula Themes — a sample NeoPad plugin

This plugin came preinstalled so you can see how NeoPad plugins work. It is
an ordinary VS Code theme extension: the same files would work in VS Code.

## What's in the folder

```
package.json                        the manifest: name, version, and what the plugin contributes
icon.svg                            shown in the Plugins window
themes/nebula-color-theme.json      the dark theme
themes/nebula-dawn-color-theme.json the light theme
```

`package.json` lists both themes under `contributes.themes`. Each entry names
the theme, says whether it is light (`vs`) or dark (`vs-dark`), and points at
its JSON file.

## What a theme file contains

- **`colors`** — the app around the text: editor background, cursor, selection,
  line numbers, tabs, sidebar, borders, and the terminal's 16 ANSI colours.
  NeoPad uses these to colour the whole window, the terminal and the Markdown
  preview, not just the editor.
- **`tokenColors`** — syntax highlighting. Each rule matches TextMate *scopes*
  such as `comment`, `string` or `entity.name.function`, and sets a colour and
  optional `fontStyle` (`italic`, `bold`, `underline`, `strikethrough`).

## Try changing it

1. In NeoPad, open **Plugins** (⌘⇧X) and click **Show files** on this plugin.
2. Open `themes/nebula-color-theme.json` in NeoPad.
3. Change a colour — for example `"editor.background"` — and save.
4. Back in **Plugins**, click **Reload**. If Nebula is your current theme, the
   change appears straight away.

## Make your own

Copy this folder, then in the copy's `package.json` change `name` (and the
theme `label`s) so it doesn't clash with this one. Put the copy in the plugins
folder (**Plugins → Open folder**) and click **Reload**.

## Get more

**Plugins → Browse** searches Open VSX, the open registry of VS Code
extensions. NeoPad uses the themes, syntax highlighting, snippets and language
settings in them. It never runs extension code.
