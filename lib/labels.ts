// English / Hindi labels. Hindi regulatory terminology must be reviewed by a qualified translator before official use.
export type Language = 'en' | 'hi';
export const L = {
  en: {
    appName: 'Sakshya', tagline: 'Every finding points at its evidence. Agents propose, rules verify, humans decide.',
    overview: 'Case desk', applications: 'Applications', forensics: 'Integrity indicators', infrastructure: 'Infrastructure',
    authority: 'Source verification', notices: 'Deficiency notices', audit: 'Audit ledger', rulebook: 'Executable Handbook',
    alerts: 'Alerts', system: 'Implementation status', core: 'SCRUTINY', evidence: 'EVIDENCE', governance: 'GOVERNANCE',
    pass: 'Pass', deficiency: 'Deficiency', needs_review: 'Needs review', not_checked: 'Not checked', processing: 'Processing', indicator: 'Indicator',
    demo: 'DEMO DATA', role: 'Role',
  },
  hi: {
    appName: 'साक्ष्य', tagline: 'एआईसीटीई संवीक्षा निर्णय-सहायता - एजेंट सुझाते हैं, नियम जाँचते हैं, मनुष्य निर्णय लेते हैं',
    overview: 'प्रकरण डेस्क', applications: 'आवेदन', forensics: 'अखंडता संकेतक', infrastructure: 'अवसंरचना',
    authority: 'स्रोत सत्यापन', notices: 'कमी सूचनाएँ', audit: 'ऑडिट बही', rulebook: 'निष्पादन-योग्य हैंडबुक',
    alerts: 'अलर्ट', system: 'कार्यान्वयन स्थिति', core: 'संवीक्षा', evidence: 'साक्ष्य', governance: 'प्रशासन',
    pass: 'उत्तीर्ण', deficiency: 'कमी', needs_review: 'समीक्षा आवश्यक', not_checked: 'जाँच नहीं हुई', processing: 'प्रसंस्करण', indicator: 'संकेतक',
    demo: 'डेमो डेटा', role: 'भूमिका',
  },
} as const;
export type Labels = typeof L['en'];
