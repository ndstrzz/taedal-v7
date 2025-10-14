import { Router } from "express";
import bodyParser from "body-parser";
import Stripe from "stripe";
import { sbAdmin } from "../lib/supabase";

const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

// It’s OK if stripeSecret is empty in dev; we just won’t process events.
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: "2024-06-20" }) : null;

export const stripeRouter = Router();

// Stripe needs the *raw* body for signature verification
stripeRouter.post(
  "/webhooks/stripe",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe || !webhookSecret) {
        return res.status(500).json({ error: "Stripe not configured" });
      }

      const sig = req.headers["stripe-signature"] as string;
      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        console.error("⚠️  Stripe signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        // We’ll pass our internal order_id when creating the Checkout Session (soon).
        const orderId = session.metadata?.order_id;
        if (orderId) {
          const { error } = await sbAdmin.rpc("mark_order_paid", {
            p_order_id: orderId,
            p_chain_id: 0,          // fiat flow: no chain involved
            p_tx_hash: null,
          });
          if (error) {
            console.error("mark_order_paid error:", error.message);
            return res.status(500).json({ error: "Failed to settle order" });
          }
        }
      }

      res.json({ received: true });
    } catch (e: any) {
      console.error("stripe webhook error", e);
      res.status(500).json({ error: "internal error" });
    }
  }
);
