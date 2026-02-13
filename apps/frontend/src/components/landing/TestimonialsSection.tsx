import { Card, CardContent } from "@/components/ui/card";

const testimonials = [
  {
    quote: "I was refreshing forums obsessively. ILR Timelines showed me my wait was actually normal \u2014 and I got approved 2 weeks later.",
    name: "Priya S.",
    detail: "India \u00B7 138 days",
  },
  {
    quote: "The data from hundreds of applicants gave me a realistic picture. No more guessing when my ILR decision would come.",
    name: "Chukwu O.",
    detail: "Nigeria \u00B7 162 days",
  },
  {
    quote: "Being able to filter by visa type and nationality was a game-changer. I finally knew what to expect.",
    name: "Fatima K.",
    detail: "Pakistan \u00B7 155 days",
  },
];

const TestimonialsSection = () => {
  return (
    <section id="testimonials" className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-primary">Testimonials</p>
          <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
            Trusted by applicants
          </h2>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
          {testimonials.map((t) => (
            <Card key={t.name} className="border bg-card shadow-none">
              <CardContent className="p-6">
                {/* Stars */}
                <div className="mb-4 flex gap-0.5 text-chart-4">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="mb-5 text-sm leading-relaxed text-foreground">&ldquo;{t.quote}&rdquo;</p>
                <div className="border-t pt-4">
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.detail}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
