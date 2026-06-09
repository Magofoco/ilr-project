import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "What is ILR?",
    answer:
      "ILR stands for Indefinite Leave to Remain. It's UK permanent residency — the right to live, work and study in the UK with no time limit. You apply online, attend a fingerprint appointment, and then wait for a Home Office decision.",
  },
  {
    question: "How long does ILR actually take?",
    answer:
      "The Home Office\u2019s public target is 6 months, but real waits often run longer and vary by route, nationality, where you gave fingerprints, and which service you paid for. The free dashboard shows the current typical wait across thousands of recent cases.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "We read public UK immigration forums where applicants share their own timelines — application date, biometrics, and decision. Every case keeps a link back to the original post so you can verify it.",
  },
  {
    question: "Is the data accurate?",
    answer:
      "It\u2019s real applicants reporting their own cases, so individual posts vary. We aggregate across many of them and treat people who are still waiting as still waiting (not as failures), which keeps the typical wait honest.",
  },
  {
    question: "Will my information be private?",
    answer:
      "Yes. We don\u2019t store forum usernames anywhere. We don\u2019t collect personal data from you, and your account is only used to remember your filters.",
  },
  {
    question: "Is this immigration advice?",
    answer:
      "No. We report waiting-time statistics. We do not tell you whether to apply or what to put on your application — for that, speak to a regulated immigration adviser.",
  },
  {
    question: "How often does the data update?",
    answer:
      "Our scraper runs daily, and the charts and statistics refresh automatically. New cases usually appear within 24 hours of being posted.",
  },
];

const FAQSection = () => {
  return (
    <section id="faq" className="border-t bg-muted/30 py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">
            FAQ
          </p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            Common questions
          </h2>
          <p className="text-base text-muted-foreground">
            New to UK immigration? Start here.
          </p>
        </div>

        <div className="mx-auto max-w-2xl">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="mb-2 border-b-0"
              >
                <div className="rounded-lg border bg-card px-5">
                  <AccordionTrigger className="py-4 text-left text-sm font-medium text-foreground hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FAQSection;
