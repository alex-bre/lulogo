import { useEffect, useRef } from 'react'
import { ChevronRight, ExternalLink, FileCode, FileText, IdCard, Scale, ShieldCheck, Type, X } from 'lucide-react'
import { APP_VERSION, BUILD_LABEL, BUILD_SOURCE_URL, COMMIT_SHA } from '../buildInfo'
import styles from './AboutDialog.module.css'

/**
 * Resolves a path against the deployment's base URL, the same way
 * model/fonts.js resolves font files: `base` is `'./'`, so a root-absolute
 * `/LICENSE.txt` breaks as soon as the app is served from a sub-path — which is
 * exactly where it will be served from on GitHub Pages
 * (`alex-bre.github.io/lulogo/`).
 */
const docUrl = (path) => `${import.meta.env.BASE_URL}${path}`

/**
 * The provider, as § 5 DDG and Art. 13 GDPR require it to be named.
 *
 * Kept in one place because the Impressum and the privacy section have to agree
 * on it. If § 5 DDG applies, the address must be one where postal mail actually
 * reaches the provider — a P.O. box does not satisfy it — and publishing it
 * makes it public permanently. Empty fields are dropped from the block below,
 * so a narrower set (email only, or a c/o address) renders without a gap.
 */
const PROVIDER = {
  name: '',
  street: '',
  city: '',
  country: '',
  email: 'alex.brenner.cs@gmail.com',
}

/** Shown on the legal sections, so a reader can tell how current they are. */
const LEGAL_UPDATED = '2 September 2026'

/**
 * The documents this build has to be able to point at.
 *
 * Each of these carries an actual obligation, which is why they live in one list
 * with a test over it rather than being sprinkled through the JSX: the source of
 * the running version has to be offered (AGPL § 13), the licence and the
 * third-party notices have to travel with the distributed build (AGPL § 4, and
 * the MIT/ISC notice clauses), and the font licences have to travel with the
 * fonts (OFL). A link here that 404s is a compliance bug.
 */
export const ABOUT_LINKS = [
  {
    href: BUILD_SOURCE_URL,
    external: true,
    icon: FileCode,
    label: 'Source code',
    note: `Build (${COMMIT_SHA})`,
  },
  {
    href: docUrl('LICENSE.txt'),
    icon: Scale,
    label: 'Licence — AGPL-3.0-only',
    note: 'What you may do with this code, and the warranty disclaimer',
  },
  {
    href: docUrl('THIRD-PARTY-NOTICES.txt'),
    icon: FileText,
    label: 'Third-party notices',
    note: 'Copyright notices of the bundled libraries',
  },
  {
    href: docUrl('fonts/NOTICE.txt'),
    icon: Type,
    label: 'Font licences',
    note: 'Bundled typefaces, all under the SIL Open Font License 1.1',
  },
]

/** Section header for the two collapsed legal texts. */
function LegalSection({ icon: Icon, label, note, children }) {
  return (
    <details className={styles.section}>
      <summary className={styles.summary}>
        <ChevronRight className={styles.chevron} size={14} aria-hidden />
        <Icon className={styles.linkIcon} size={16} aria-hidden />
        <span className={styles.linkText}>
          <span className={styles.linkLabel}>{label}</span>
          <span className={styles.linkNote}>{note}</span>
        </span>
      </summary>
      <div className={styles.sectionBody}>
        {children}
        <p className={styles.updated}>Last updated {LEGAL_UPDATED}.</p>
      </div>
    </details>
  )
}

/**
 * Modal shown by the TopBar's info button: build identity, the documents above,
 * and the privacy policy and Impressum inline.
 *
 * The two legal texts are sections here rather than pages of their own because
 * this is a single-page app served as static files — a separate page would be a
 * second document to keep in step, and a visitor would have to leave the editor
 * to read it.
 */
export default function AboutDialog({ onClose }) {
  const cardRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    // Capture phase and stopPropagation: useShortcuts also listens for Escape,
    // where it clears the selection. Closing a dialog should not quietly
    // deselect the user's work behind it.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (!cardRef.current?.contains(e.target)) onClose()
      }}
    >
      <div
        className={styles.card}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            {/* The lockup is the heading: it carries the wordmark, so the name
                is the image's alt text rather than a line of type beside it. */}
            <h2 className={styles.title} id="about-title">
              <img className={styles.logo} src={docUrl('lulogo-logo.svg')} width="97" height="30" alt="Lulogo" />
            </h2>
            <p className={styles.build} title={BUILD_LABEL}>
              Version {APP_VERSION} · build {COMMIT_SHA}
            </p>
          </div>
          <button className={styles.iconBtn} ref={closeRef} onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>

        <p className={styles.blurb}>
          An infinite-canvas SVG editor that runs entirely in your browser. Nothing you draw is
          uploaded — your document is saved in this browser, on this device, and clearing the site
          data deletes it.
        </p>

        <ul className={styles.links}>
          {ABOUT_LINKS.map(({ href, external, icon: Icon, label, note }) => (
            <li key={href}>
              <a className={styles.link} href={href} target="_blank" rel="noreferrer noopener">
                <Icon className={styles.linkIcon} size={16} aria-hidden />
                <span className={styles.linkText}>
                  <span className={styles.linkLabel}>
                    {label}
                    {external && <ExternalLink className={styles.extIcon} size={11} aria-hidden />}
                  </span>
                  <span className={styles.linkNote}>{note}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <LegalSection
          icon={ShieldCheck}
          label="Privacy policy"
          note="No tracking, no uploads — what is stored locally, and where"
        >
          <p>
            Lulogo has no server component, no account, and no login. It sets no cookies and runs
            no analytics, tracking, or crash reporting, and fonts, scripts, and styles are served
            from this site alone. Importing, editing, and exporting all happen in your browser —
            nothing you draw is uploaded.
          </p>

          <h3>Data stored on your device</h3>
          <p>
            Your work and your light/dark preference are kept in this browser's local storage,
            under <code>lulogo.document.v1</code> (the document you are editing, including any
            images you imported), <code>lulogo.document.v1.unreadable</code> (an earlier autosave
            the current version cannot read, kept so it is not silently overwritten), and{' '}
            <code>lulogo.theme</code>. None of it is transmitted anywhere, and it stays until you
            clear this site's data in your browser settings — which also discards your unsaved
            drawing, so export it first.
          </p>

          <h3>Hosting</h3>
          <p>
            This site is served by GitHub Pages (GitHub, Inc., 88 Colin P. Kelly Jr. Street, San
            Francisco, CA 94107, USA), whose servers log technical access data — your IP address,
            the time, the file requested, your user agent, and any referring page — to deliver the
            site and keep it secure (Art. 6(1)(f) GDPR), which involves a transfer to the USA.
            Those logs are created and controlled by GitHub, not by the provider named below, who
            has no access to them; see the{' '}
            <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noreferrer noopener">
              GitHub Privacy Statement
            </a>
            .
          </p>

          <h3>Your rights</h3>
          <p>
            Controller under Art. 4(7) GDPR is the provider named under Impressum below. You have
            the rights to information, rectification, erasure, restriction, portability, and
            objection (Art. 15–21 GDPR) and may complain to a supervisory authority (Art. 77). In
            practice there is little to act on: no accounts and no database are held here, and
            requests about the server logs above have to go to GitHub.
          </p>
        </LegalSection>

        <LegalSection
          icon={IdCard}
          label="Impressum"
          note="Provider identification under § 5 DDG"
        >
          <h3>Provider</h3>
          <address className={styles.address}>
            {[PROVIDER.name, PROVIDER.street, PROVIDER.city, PROVIDER.country]
              .filter(Boolean)
              .map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
            Email: {PROVIDER.email}
          </address>
          <p>
            Lulogo is a privately operated, non-commercial project, offered free of charge with no
            advertising and nothing for sale — hence no commercial register entry and no VAT
            identification number.
          </p>

          <h3>Liability</h3>
          <p>
            The app comes with no guarantee that it is correct or fit for any purpose; sections 15
            and 16 of the{' '}
            <a href={docUrl('LICENSE.txt')} target="_blank" rel="noreferrer noopener">
              licence
            </a>{' '}
            disclaim warranty and liability, and statutory liability that cannot be excluded is
            unaffected. Linked external pages are the responsibility of their operators; a link
            will be removed on concrete indication that something is wrong.
          </p>

          <h3>Copyright</h3>
          <p>
            The source code is under the GNU Affero General Public License v3.0 only; the bundled
            libraries and fonts keep their own licences, listed above. The licence grants no rights
            to the project's name. Drawings you make with the editor are yours.
          </p>
        </LegalSection>

        <p className={styles.footnote}>
          Free software under the GNU Affero General Public License v3.0. It comes with absolutely
          no warranty.
        </p>
      </div>
    </div>
  )
}
