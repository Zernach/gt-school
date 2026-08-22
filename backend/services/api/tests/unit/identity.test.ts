import { IdentityIndex, resolveFixtureIdentities } from '../../src/domain/identity.js';
import { cleanFixture, makeContact, makePayment, makeStudent, siblingFixture } from '../helpers/fixtures.js';

describe('IdentityIndex contact resolution', () => {
  it('prefers a compatible hard external ID', () => {
    const student = makeStudent(0);
    const result = new IdentityIndex([student]).resolveContact(makeContact(0, student));
    expect(result).toMatchObject({ status: 'linked', method: 'hard_external_id', scoreBp: 10_000, student: { id: student.id } });
  });

  it('does not accept an unknown hard ID as proof', () => {
    const student = makeStudent(0);
    const contact = makeContact(0, student, { external_id: makeStudent(99).id });
    const result = new IdentityIndex([student]).resolveContact(contact);
    expect(result.status).toBe('linked');
    expect(result.method).toBe('name_dob');
  });

  it('uses exact name plus DOB when email is materially different', () => {
    const student = makeStudent(0);
    const contact = makeContact(0, student, { external_id: undefined, email: 'alternate@example.test' });
    expect(new IdentityIndex([student]).resolveContact(contact)).toMatchObject({ status: 'linked', method: 'name_dob', scoreBp: 9000 });
  });

  it('uses exact canonical email when no stronger identity is available', () => {
    const student = makeStudent(0);
    const contact = makeContact(0, student, { external_id: undefined, dob: undefined, first_name: 'Unknown', last_name: 'Contact' });
    expect(new IdentityIndex([student]).resolveContact(contact)).toMatchObject({ status: 'linked', method: 'exact_email', scoreBp: 9500 });
  });

  it('recognizes a Gmail alias without applying Gmail rules globally', () => {
    const student = makeStudent(0, { guardian_email: 'jane.doe@gmail.com' });
    const contact = makeContact(0, student, { external_id: undefined, dob: undefined, first_name: 'Unknown', last_name: 'Contact', email: 'janedoe+crm@googlemail.com' });
    expect(new IdentityIndex([student]).resolveContact(contact)).toMatchObject({ status: 'linked', method: 'gmail_alias', scoreBp: 9250 });
  });

  it('leaves a contact unlinked when no supported evidence exists', () => {
    const student = makeStudent(0);
    const contact = makeContact(0, student, { external_id: undefined, dob: undefined, first_name: 'Other', last_name: 'Person', email: 'other@example.test' });
    expect(new IdentityIndex([student]).resolveContact(contact)).toEqual({ status: 'unlinked', method: 'none', scoreBp: 0, evidence: {} });
  });

  it('returns ambiguous instead of picking one student who shares guardian email', () => {
    const fixtures = siblingFixture();
    const contact = makeContact(99, fixtures.appStudents[0]!, { external_id: undefined, dob: undefined, first_name: 'Guardian', last_name: 'Shared', email: 'shared-guardian@example.test' });
    const result = new IdentityIndex(fixtures.appStudents).resolveContact(contact);
    expect(result.status).toBe('ambiguous');
    expect(result.method).toBe('ambiguous');
    expect(result.evidence).toEqual({ candidates: fixtures.appStudents.map(({ id }) => id) });
  });

  it('keeps siblings distinct when name and DOB identify one child', () => {
    const fixtures = siblingFixture();
    for (let index = 0; index < fixtures.appStudents.length; index += 1) {
      const result = new IdentityIndex(fixtures.appStudents).resolveContact(fixtures.crmContacts[index]!);
      expect(result.student?.id).toBe(fixtures.appStudents[index]!.id);
    }
  });

  it('returns ambiguous for colliding name plus DOB records', () => {
    const first = makeStudent(0);
    const second = makeStudent(1, { first_name: first.first_name, last_name: first.last_name, dob: first.dob, guardian_email: 'second@example.test' });
    const contact = makeContact(0, first, { external_id: undefined, email: 'none@example.test' });
    const result = new IdentityIndex([first, second]).resolveContact(contact);
    expect(result.status).toBe('ambiguous');
    expect((result.evidence.candidates as string[])).toEqual([first.id, second.id]);
  });
});

describe('IdentityIndex payment resolution', () => {
  it('prefers payment external_ref', () => {
    const student = makeStudent(0);
    expect(new IdentityIndex([student]).resolvePayment(makePayment(0, student))).toMatchObject({ status: 'linked', method: 'hard_external_id', student: { id: student.id } });
  });

  it('falls back from an unknown external_ref to name plus DOB', () => {
    const student = makeStudent(0);
    const payment = makePayment(0, student, { external_ref: makeStudent(99).id });
    expect(new IdentityIndex([student]).resolvePayment(payment)).toMatchObject({ status: 'linked', method: 'name_dob', student: { id: student.id } });
  });

  it('uses name plus DOB when no hard reference is populated', () => {
    const student = makeStudent(0);
    const payment = makePayment(0, student, { external_ref: undefined, payer_email: 'billing@example.test' });
    expect(new IdentityIndex([student]).resolvePayment(payment)).toMatchObject({ status: 'linked', method: 'name_dob', scoreBp: 9000 });
  });

  it('uses unique payer email only after stronger evidence is absent', () => {
    const student = makeStudent(0);
    const payment = makePayment(0, student, { external_ref: undefined, student_name: undefined, student_dob: undefined });
    expect(new IdentityIndex([student]).resolvePayment(payment)).toMatchObject({ status: 'linked', method: 'exact_email', scoreBp: 9500 });
  });

  it('does not select one sibling using a shared payer email', () => {
    const fixtures = siblingFixture();
    const payment = makePayment(99, fixtures.appStudents[0]!, { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'shared-guardian@example.test' });
    expect(new IdentityIndex(fixtures.appStudents).resolvePayment(payment).status).toBe('ambiguous');
  });

  it('leaves an orphan payment explicitly unlinked', () => {
    const student = makeStudent(0);
    const payment = makePayment(99, makeStudent(99), { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'orphan@example.test' });
    expect(new IdentityIndex([student]).resolvePayment(payment)).toEqual({ status: 'unlinked', method: 'none', scoreBp: 0, evidence: {} });
  });

  it('returns ambiguity for two records with identical name and DOB', () => {
    const first = makeStudent(0);
    const second = makeStudent(1, { first_name: first.first_name, last_name: first.last_name, dob: first.dob });
    const payment = makePayment(0, first, { external_ref: undefined, payer_email: 'unrelated@example.test' });
    expect(new IdentityIndex([first, second]).resolvePayment(payment).status).toBe('ambiguous');
  });
});

describe('resolveFixtureIdentities', () => {
  it('builds deterministic contact and payment indexes', () => {
    const fixtures = cleanFixture(5);
    const result = resolveFixtureIdentities(fixtures);
    expect(result.contactStudentIds.size).toBe(5);
    expect(result.paymentStudentIds.size).toBe(5);
    fixtures.appStudents.forEach((student, index) => {
      expect(result.contactStudentIds.get(`crm-${index}`)).toBe(student.id);
      expect(result.paymentStudentIds.get(`payment-record-${index}`)).toBe(student.id);
    });
  });

  it('omits ambiguous and unlinked source records', () => {
    const fixtures = cleanFixture(1);
    fixtures.crmContacts.push(makeContact(9, makeStudent(9), { external_id: undefined, dob: undefined, email: 'orphan@example.test' }));
    fixtures.payments.push(makePayment(9, makeStudent(9), { external_ref: undefined, student_name: undefined, student_dob: undefined, payer_email: 'orphan@example.test' }));
    const result = resolveFixtureIdentities(fixtures);
    expect(result.contactStudentIds.has('crm-9')).toBe(false);
    expect(result.paymentStudentIds.has('payment-record-9')).toBe(false);
  });

  it('produces the same indexes regardless of source record order', () => {
    const fixtures = cleanFixture(8);
    const forward = resolveFixtureIdentities(fixtures);
    const reverse = resolveFixtureIdentities({ ...fixtures, crmContacts: [...fixtures.crmContacts].reverse(), payments: [...fixtures.payments].reverse() });
    expect([...reverse.contactStudentIds].sort()).toEqual([...forward.contactStudentIds].sort());
    expect([...reverse.paymentStudentIds].sort()).toEqual([...forward.paymentStudentIds].sort());
  });
});
