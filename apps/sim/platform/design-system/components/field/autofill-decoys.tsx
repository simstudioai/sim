/**
 * Takes a password manager's autofill so it leaves a secret field alone. Offscreen rather than
 * hidden: managers skip hidden fields, and would fill the real one.
 */
import styles from '@/platform/design-system/components/field/field.module.css'

export function AutofillDecoys() {
  return (
    <div className={styles.autofillDecoys} aria-hidden='true'>
      <input
        type='text'
        name='fakeusernameremembered'
        autoComplete='username'
        tabIndex={-1}
        readOnly
      />
      <input
        type='password'
        name='fakepasswordremembered'
        autoComplete='current-password'
        tabIndex={-1}
        readOnly
      />
      <input type='email' name='fakeemailremembered' autoComplete='email' tabIndex={-1} readOnly />
    </div>
  )
}
