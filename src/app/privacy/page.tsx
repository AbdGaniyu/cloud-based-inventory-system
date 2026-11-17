import type { Metadata } from "next";

import { STORE } from "@/config/store";
import { formatPhoneDisplay } from "@/lib/phone";

export const metadata: Metadata = { title: `Privacy notice · ${STORE.name}` };

/**
 * Public privacy notice (Nigeria Data Protection Act 2023). Staff point customers here when taking
 * their details; the POS records that they did. Have it reviewed by a lawyer before relying on it.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-surface px-4 py-10">
      <article className="mx-auto flex max-w-2xl flex-col gap-6 rounded-xl border border-border bg-card p-6 text-body leading-relaxed sm:p-8">
        <header>
          <p className="text-small font-medium text-muted-foreground">{STORE.name}</p>
          <h1 className="text-h1">How we use your details</h1>
          <p className="mt-2 text-muted-foreground">
            {STORE.name}, {STORE.contact.address}, is responsible for the personal details you give us. This notice explains what we keep, why, and
            what you can ask us to do.
          </p>
        </header>

        <Section title="What we keep">
          <ul className="list-disc pl-5">
            <li>Your name, phone number and, if you give them, your email and address.</li>
            <li>What you bought: invoices, payments, the IMEI or serial number of each device, warranty cards, returns and trade-ins.</li>
            <li>For instalment purchases: the payment schedule and, if you gave them, a guarantor&apos;s name and phone number and notes on the ID you showed.</li>
            <li>The receipts, warranty cards and reminders we send you, and whether they were delivered.</li>
          </ul>
        </Section>

        <Section title="Why">
          <ul className="list-disc pl-5">
            <li><strong>To sell to you and honour your warranty</strong> (our contract with you): receipts, warranty checks, returns and repairs.</li>
            <li><strong>To run your instalment plan</strong> (our contract with you): reminders before and after due dates, and payment confirmations.</li>
            <li><strong>To keep proper accounts</strong> (a legal obligation): tax law requires us to keep sales and payment records for at least six years.</li>
            <li><strong>To prevent fraud</strong> (our legitimate interest): checking a device&apos;s IMEI or serial against our records.</li>
          </ul>
          <p className="mt-2">We don&apos;t sell your details and we don&apos;t send you advertising.</p>
        </Section>

        <Section title="Who sees it">
          <p>
            Our staff, as their job needs (cashiers don&apos;t see more than they need). Messages go through WhatsApp (Meta) or an SMS provider, who
            receive your number and the message text to deliver it. Our software and database are hosted by a cloud provider under contract. We
            share details with the authorities only when the law requires it.
          </p>
        </Section>

        <Section title="How long">
          <p>
            Sales and payment records: at least six years (tax law). The text of messages we sent you: one year. Warranty records: until the
            warranty ends and the records above no longer need them.
          </p>
        </Section>

        <Section title="Your rights">
          <p>You can ask us, free of charge, to:</p>
          <ul className="list-disc pl-5">
            <li>give you a copy of the details we hold about you;</li>
            <li>correct anything that is wrong;</li>
            <li>stop sending you WhatsApp or SMS messages (you&apos;ll then get receipts on paper only);</li>
            <li>erase your details. We will, except the sales and payment records the law makes us keep, and not while you still owe on an instalment plan.</li>
          </ul>
          <p className="mt-2">
            Ask at any of our stores, email <a className="underline underline-offset-2" href={`mailto:${STORE.contact.email}`}>{STORE.contact.email}</a> or
            call {formatPhoneDisplay(STORE.contact.phone)}. We may ask you to prove who you are first, and we&apos;ll answer within 30 days. If you are
            not happy with how we handled your details, you can complain to the Nigeria Data Protection Commission (NDPC).
          </p>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-h3">{title}</h2>
      {children}
    </section>
  );
}
