import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "What is ILR (Indefinite Leave to Remain)?",
    answer: "ILR is a UK immigration status that allows you to live and work in the UK permanently without time restrictions. It's commonly called 'settlement' or 'permanent residency'.",
  },
  {
    question: "Where does the data come from?",
    answer: "We scrape popular UK immigration forums where applicants share their timelines \u2014 submission dates, biometrics, and decision dates. All data is anonymised and aggregated.",
  },
  {
    question: "How accurate is the data?",
    answer: "It's crowdsourced from real applicants, so individual cases vary. However, aggregated trends across hundreds of data points provide reliable processing time estimates.",
  },
  {
    question: "Is my data private?",
    answer: "We don't collect any personal data. Everything displayed comes from publicly available forum posts. No personal information is stored or shared.",
  },
  {
    question: "How often is the data updated?",
    answer: "Our scrapers run daily. Charts and statistics refresh automatically to reflect the most current processing trends.",
  },
];

const FAQSection = () => {
  return (
    <section id="faq" className="border-t bg-muted/30 py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">FAQ</p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            Common questions
          </h2>
        </div>

        <div className="mx-auto max-w-2xl">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`} className="border-b-0 mb-2">
                <div className="rounded-lg border bg-card px-5">
                  <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline py-4">
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
