# Madain Website

Marketing site for **Mada'in Properties Co (Mada'in) (P.J.S.C)** — a transitional site that surfaces the General Assembly Meeting announcement and redirects visitors to the live site at [madain.com](https://madain.com) while the new site is being built.

## Stack

- [Astro 4](https://astro.build/) — static site generator
- [Tailwind CSS 3](https://tailwindcss.com/) via `@astrojs/tailwind`
- TypeScript (strict)

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static output → ./dist
npm run preview   # preview the built site
```

## Project structure

```
src/
├── layouts/
│   └── Layout.astro          # base HTML + fonts
├── pages/
│   └── index.astro           # single-page composition
├── components/
│   ├── Header.astro          # top gold bar + wordmark + nav
│   ├── AnnouncementBanner.astro
│   ├── About.astro
│   ├── SectionHeading.astro
│   ├── ProjectCard.astro
│   ├── CompletedProjects.astro
│   ├── UpcomingProjects.astro
│   ├── Investment.astro
│   ├── VideoGallery.astro
│   ├── Blog.astro
│   ├── AppointmentCTA.astro
│   └── Footer.astro
└── styles/
    └── global.css            # Tailwind entry + Lato/Inter fonts
public/
└── images/                   # logo + announcement banner
```

## Design tokens

Defined in `tailwind.config.mjs` under `theme.extend`:

- Colors: `madain-gold` `#9C8830`, `madain-goldDark` `#78682A`, `madain-bronze` `#6E5E33`, `madain-shaft` `#242424`, plus supporting greys.
- Gradients: `bg-gold-gradient`, `bg-gold-gradient-v`, `bg-footer-gradient`.
- Fonts: `Lato` (body) and `Inter` (numerals).

## Notes

- Navigation and CTAs redirect to `https://madain.com/...` pages — this site does not host any secondary routes yet.
- The announcement banner is a single image at `public/images/announcement-banner.png`.

## License

Proprietary — © Mada'in Properties Co (P.J.S.C).
