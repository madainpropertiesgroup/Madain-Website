// The announcement of the adjournment.
//
// The site does not restate, summarise or interpret the minutes. The minutes
// are a document filed with the Ministry of Economy and Tourism and the
// competent authority; a second account of them published here could drift
// from the one on file, and no reading of them written on this site would
// carry any authority anyway. So the announcement says what a shareholder has
// to act on, and the document itself is attached for anyone who wants the
// detail.
//
// Nothing below is a reading of the minutes. Every fact in it is either the
// company's own announcement or a date already published in the convocation.
export const eyebrow = 'إعلان الجمعية العمومية';

export const headline = 'إعلان تأجيل اجتماع الجمعية العمومية إلى الموعد الثاني';

// Two paragraphs: the fact, then the date that replaces it. The emphasised
// runs are the two things a shareholder has to carry away.
export const body = [
  [
    { t: 'تعلن شركة مدائن العقارية ش.م.خ عن عدم اكتمال النصاب القانوني اللازم لانعقاد الاجتماع الأول للجمعية العمومية المحدد بتاريخ 4 نوفمبر 2026.' },
  ],
  [
    { t: 'وعليه، يُعقد الاجتماع في موعده الثاني المحدد مسبقاً في الدعوة المنشورة، وذلك يوم الأربعاء الموافق ' },
    { t: '11 نوفمبر 2026، الساعة 10:00 صباحاً', b: true },
    { t: '، في فندق سويس أوتيل المروج – دبي، وبذات جدول الأعمال.' },
  ],
];

// The third paragraph exists only when the minutes are actually attached: it
// refers the reader to an attachment, so it must not appear without one.
export const attachmentBody = [
  { t: 'وللاطلاع على تفاصيل عدم اكتمال النصاب القانوني للاجتماع الأول، يرجى الرجوع إلى ' },
  { t: 'محضر إثبات عدم اكتمال النصاب القانوني', b: true },
  { t: ' المرفق.' },
];

export const attachmentLabel = 'الاطلاع على محضر إثبات عدم اكتمال النصاب القانوني للاجتماع الأول';

// The approved, signed minutes — the minutes alone, not the attendance sheet
// that accompanies them, which names shareholders and their holdings and is
// filed with the authority rather than published. The page shows the
// attachment only when this file is present: no link that leads nowhere, and
// no notice promising a document on a date nobody has fixed.
export const MINUTES_PDF_PATH = 'general-assembly-2026/documents/agm-minutes-quorum-2026-11-04.pdf';

// The single line the band carries on the other assembly pages.
export const bandLine =
  'لم يكتمل النصاب القانوني لاجتماع الجمعية العمومية الأول المحدد بتاريخ 4 نوفمبر 2026، ويُعقد الاجتماع ' +
  'في موعده الثاني المحدد مسبقاً في الدعوة المنشورة.';
