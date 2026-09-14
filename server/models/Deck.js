const crypto = require("crypto");
const Card = require("./Card.js");
const ActionCard = require("./ActionCard.js");
const PropertyCard = require("./PropertyCard.js");
const PropertyType = require("./PropertyType.js");
const Wildcard = require("./Wildcard.js");
const RentCard = require("./RentCard.js");
const MoneyCard = require("./MoneyCard.js");

class Deck {
    cards;
    actionCards;
    propertyCards;
    wildcards;
    rentCards;
    moneyCards;

    constructor(options = {}) {
        this.cards = [];
        this.actionCards = [];
        this.propertyCards = [];
        this.wildcards = [];
        this.rentCards = [];
        this.moneyCards = [];
        this.initializeActionCards();
        this.initializePropertyCards();
        this.initializeWildcards();
        this.initializeRentCards();
        this.initializeMoneyCards();
        this.createDeck(options);
    }

    initializeActionCards() {
        const makeDealBreaker = () => new ActionCard("Deal Breaker", "Steals a complete set of properties from any player. (Includes any buildings) Play into center to use.", 5);
        const makeJustSayNo = () => new ActionCard("Just Say No", "Use any time when an action card is played against you. Play into center to use.", 4);
        const makeSlyDeal = () => new ActionCard("Sly Deal", "Steal a property from the player of your choice. (Cannot be part of a full set) Play into center to use.", 3);
        const makeForcedDeal = () => new ActionCard("Forced Deal", "Swap any property with another player. (Cannot be part of a full set) Play into center to use.", 3);
        const makeDebtCollector = () => new ActionCard("Debt Collector", "Force any player to pay you 5M. Play into center to use.", 3);
        const makeItsMyBirthday = () => new ActionCard("Its My Birthday", "All players give you 2M as a 'gift'. Play into center to use.", 2);
        const makePassGo = () => new ActionCard("Pass Go", "Draw 2 extra cards. Play into center to use.", 1);
        const makeHouse = () => new ActionCard("House", "Add onto any full set you own to add 3M to the rent value. (Except railroads and Utility)", 3);
        const makeHotel = () => new ActionCard("Hotel", "Add onto any full set you own to add 4M to the rent value. (Except railroads and Utility)", 4);
        const makeDoubleTheRent = () => new ActionCard("Double The Rent", "Needs to played with a rent card. Play into center to use.", 1);

        for (let i = 0; i < 2; i++) {
            this.actionCards.push(makeDealBreaker());
            this.actionCards.push(makeDoubleTheRent());
        }
        for (let i = 0; i < 3; i++) {
            this.actionCards.push(makeJustSayNo());
            this.actionCards.push(makeSlyDeal());
            this.actionCards.push(makeDebtCollector());
            this.actionCards.push(makeItsMyBirthday());
            this.actionCards.push(makeHouse());
            this.actionCards.push(makeHotel());
        }
        for (let i = 0; i < 4; i++) {
            this.actionCards.push(makeForcedDeal());
        }
        for (let i = 0; i < 10; i++) {
            this.actionCards.push(makePassGo());
        }
    }

    initializePropertyCards() {
        this.propertyCards.push(new PropertyCard("North Carolina Avenue", 4, PropertyType.Green));
        this.propertyCards.push(new PropertyCard("Pacific Avenue", 4, PropertyType.Green));
        this.propertyCards.push(new PropertyCard("Pennsylvania Avenue", 4, PropertyType.Green));

        this.propertyCards.push(new PropertyCard("Boardwalk", 4, PropertyType.DarkBlue));
        this.propertyCards.push(new PropertyCard("Park Place", 4, PropertyType.DarkBlue));

        this.propertyCards.push(new PropertyCard("Connecticut Avenue", 1, PropertyType.LightBlue));
        this.propertyCards.push(new PropertyCard("Oriental Avenue", 1, PropertyType.LightBlue));
        this.propertyCards.push(new PropertyCard("Vermont Avenue", 1, PropertyType.LightBlue));

        this.propertyCards.push(new PropertyCard("Kentucky Avenue", 3, PropertyType.Red));
        this.propertyCards.push(new PropertyCard("Indiana Avenue", 3, PropertyType.Red));
        this.propertyCards.push(new PropertyCard("Illinois Avenue", 3, PropertyType.Red));

        this.propertyCards.push(new PropertyCard("Short Line", 2, PropertyType.Railroad));
        this.propertyCards.push(new PropertyCard("B & O Railroad", 2, PropertyType.Railroad));
        this.propertyCards.push(new PropertyCard("Reading Railroad", 2, PropertyType.Railroad));
        this.propertyCards.push(new PropertyCard("Pennsylvania Railroad", 2, PropertyType.Railroad));

        this.propertyCards.push(new PropertyCard("Ventnor Avenue", 3, PropertyType.Yellow));
        this.propertyCards.push(new PropertyCard("Marvin Gardens", 3, PropertyType.Yellow));
        this.propertyCards.push(new PropertyCard("Atlantic Avenue", 3, PropertyType.Yellow));

        this.propertyCards.push(new PropertyCard("New York Avenue", 2, PropertyType.Orange));
        this.propertyCards.push(new PropertyCard("St James Place", 2, PropertyType.Orange));
        this.propertyCards.push(new PropertyCard("Tennessee Avenue", 2, PropertyType.Orange));

        this.propertyCards.push(new PropertyCard("Baltic Avenue", 1, PropertyType.Brown));
        this.propertyCards.push(new PropertyCard("Mediterranean Avenue", 1, PropertyType.Brown));

        this.propertyCards.push(new PropertyCard("St Charles Place", 2, PropertyType.Purple));
        this.propertyCards.push(new PropertyCard("Virginia Avenue", 2, PropertyType.Purple));
        this.propertyCards.push(new PropertyCard("States Avenue", 2, PropertyType.Purple));

        this.propertyCards.push(new PropertyCard("Water Works", 2, PropertyType.Utility));
        this.propertyCards.push(new PropertyCard("Electric Company", 2, PropertyType.Utility));
    }

    initializeWildcards() {
        const makeAll = () => new Wildcard("Property Wild Card", 0, [PropertyType.Green, PropertyType.DarkBlue, PropertyType.LightBlue, PropertyType.Red, PropertyType.Railroad, PropertyType.Yellow, PropertyType.Orange, PropertyType.Brown, PropertyType.Purple, PropertyType.Utility]);
        const makeDarkBlueAndGreen = () => new Wildcard("Property Wild Card", 4, [PropertyType.DarkBlue, PropertyType.Green]);
        const makeLightBlueAndBrown = () => new Wildcard("Property Wild Card", 1, [PropertyType.LightBlue, PropertyType.Brown]);
        const makeLightBlueAndRailroad = () => new Wildcard("Property Wild Card", 4, [PropertyType.LightBlue, PropertyType.Railroad]);
        const makePurpleAndOrange = () => new Wildcard("Property Wild Card", 2, [PropertyType.Purple, PropertyType.Orange]);
        const makeRailroadAndGreen = () => new Wildcard("Property Wild Card", 4, [PropertyType.Railroad, PropertyType.Green]);
        const makeRailroadAndUtility = () => new Wildcard("Property Wild Card", 2, [PropertyType.Railroad, PropertyType.Utility]);
        const makeRedAndYellow = () => new Wildcard("Property Wild Card", 3, [PropertyType.Red, PropertyType.Yellow]);

        this.wildcards.push(makeDarkBlueAndGreen());
        this.wildcards.push(makeLightBlueAndBrown());
        this.wildcards.push(makeLightBlueAndRailroad());
        this.wildcards.push(makeRailroadAndGreen());
        this.wildcards.push(makeRailroadAndUtility());
        for (let i = 0; i < 2; i++) {
            this.wildcards.push(makePurpleAndOrange());
            this.wildcards.push(makeRedAndYellow());
            this.wildcards.push(makeAll());
        }
    }

    initializeRentCards() {
        const makeAll = () => new RentCard("Rent", 3, [PropertyType.Green, PropertyType.DarkBlue, PropertyType.LightBlue, PropertyType.Red, PropertyType.Railroad, PropertyType.Yellow, PropertyType.Orange, PropertyType.Brown, PropertyType.Purple, PropertyType.Utility]);
        const makeDarkBlueAndGreen = () => new RentCard("Rent", 1, [PropertyType.DarkBlue, PropertyType.Green]);
        const makeLightBlueAndBrown = () => new RentCard("Rent", 1, [PropertyType.LightBlue, PropertyType.Brown]);
        const makePurpleAndOrange = () => new RentCard("Rent", 1, [PropertyType.Purple, PropertyType.Orange]);
        const makeRailroadAndUtility = () => new RentCard("Rent", 1, [PropertyType.Railroad, PropertyType.Utility]);
        const makeRedAndYellow = () => new RentCard("Rent", 1, [PropertyType.Red, PropertyType.Yellow]);

        for (let i = 0; i < 2; i++) {
            this.rentCards.push(makePurpleAndOrange());
            this.rentCards.push(makeRailroadAndUtility());
            this.rentCards.push(makeDarkBlueAndGreen());
            this.rentCards.push(makeLightBlueAndBrown());
            this.rentCards.push(makeRedAndYellow());
        }
        for (let i = 0; i < 3; i++) {
            this.rentCards.push(makeAll());
        }
    }

    initializeMoneyCards() {
        const make10M = () => new MoneyCard("10M", 10);
        const make5M = () => new MoneyCard("5M", 5);
        const make4M = () => new MoneyCard("4M", 4);
        const make3M = () => new MoneyCard("3M", 3);
        const make2M = () => new MoneyCard("2M", 2);
        const make1M = () => new MoneyCard("1M", 1);

        this.moneyCards.push(make10M());
        for (let i = 0; i < 2; i++) {
            this.moneyCards.push(make5M());
        }
        for (let i = 0; i < 3; i++) {
            this.moneyCards.push(make4M());
            this.moneyCards.push(make3M());
        }
        for (let i = 0; i < 5; i++) {
            this.moneyCards.push(make2M());
        }
        for (let i = 0; i < 6; i++) {
            this.moneyCards.push(make1M());
        }
    }

    createDeck(options = {}) {
        this.cards = [
            ...this.actionCards,
            ...this.propertyCards,
            ...this.wildcards,
            ...this.rentCards,
            ...this.moneyCards
        ];

        // Ensure every card has a cryptographically unique UUID
        for (let i = 0; i < this.cards.length; i++) {
            this.cards[i].id = crypto.randomUUID();
        }

        this.shuffleArray(this.cards, options.rng);
    }

    shuffleArray(array, rng) {
        let currentIndex = array.length, temporaryValue, randomIndex;
        const randomInt = rng || ((min, max) => crypto.randomInt(min, max));
        while (0 !== currentIndex) {
            randomIndex = randomInt(0, currentIndex);
            currentIndex -= 1;
            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }
        return array;
    }
}

module.exports = Deck;
