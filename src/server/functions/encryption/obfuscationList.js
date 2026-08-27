import makeAesSecretKey from './makeAesSecretKey.js';
import obfuscatedStr from './obfuscatedStr.js';

export const obfuscationList = {
  indianPocker: () => {
    return {
      /*
      BOOLEAN: {
        k: 'HWXQCUPGOE', // [72, 87, 88, 81, 67, 85, 80, 71, 79, 69]
        v: {
          true: 'ECHAJDIPBK', // [69, 67, 72, 65, 74, 68, 73, 80, 66, 75]
          false: 'FJYTOKXWUN', // [70, 74, 89, 84, 79, 75, 88, 87, 85, 78]
        },
      },
      */
      /* SECRET_KEY: {
        k: 'SXIEUDBLPN', // [83, 88, 73, 69, 85, 68, 66, 76, 80, 78]
        v: makeAesSecretKey(),
      }, */
      PUBLIC_CARD_NUMS: {
        k: 'TNUFGJXDCM', // [84, 78, 85, 70, 71, 74, 88, 68, 67, 77]
        v: {
          NUM_1: 'OEJNIHMKXT', // [79, 69, 74, 78, 73, 72, 77, 75, 88, 84]
          NUM_2: 'GIZFNPTSVK', // [71, 73, 90, 70, 78, 80, 84, 83, 86, 75]
          NUM_3: 'OCNLTGMFKS', // [79, 67, 78, 76, 84, 71, 77, 70, 75, 83]
          NUM_4: 'DKHOXMIVEA', // [68, 75, 72, 79, 88, 77, 73, 86, 69, 65]
          NUM_5: 'PDBIZUOFMJ', // [80, 68, 66, 73, 90, 85, 79, 70, 77, 74]
          NUM_6: 'KFOUDBRZVI', // [75, 70, 79, 85, 68, 66, 82, 90, 86, 73]
          NUM_7: 'MIPGSHDAUF', // [77, 73, 80, 71, 83, 72, 68, 65, 85, 70]
          NUM_8: 'SJRWTDGUXH', // [83, 74, 82, 87, 84, 68, 71, 85, 88, 72]
          NUM_9: 'HJZUTOXFQA', // [72, 74, 90, 85, 84, 79, 88, 70, 81, 65]
          NUM_10: 'JRPFIGSBDN', // [74, 82, 80, 70, 73, 71, 83, 66, 68, 78]
        },
      },
      PRIVATE_CARD_NUMS: {
        k: 'PLHGVIEBNQ', // [80, 76, 72, 71, 86, 73, 69, 66, 78, 81]
        v: {
          NUM_1: 'FKYXINCVUP', // [70, 75, 89, 88, 73, 78, 67, 86, 85, 80]
          NUM_2: 'CWYTHMUGLD', // [67, 87, 89, 84, 72, 77, 85, 71, 76, 68]
          NUM_3: 'LXSGMZAYUF', // [76, 88, 83, 71, 77, 90, 65, 89, 85, 70]
          NUM_4: 'TRHLUEKYPI', // [84, 82, 72, 76, 85, 69, 75, 89, 80, 73]
          NUM_5: 'HFSPOEWBDI', // [72, 70, 83, 80, 79, 69, 87, 66, 68, 73]
          NUM_6: 'RTASQOCGIZ', // [82, 84, 65, 83, 81, 79, 67, 71, 73, 90]
          NUM_7: 'YKIQHRWOMJ', // [89, 75, 73, 81, 72, 82, 87, 79, 77, 74]
          NUM_8: 'RPSGLDTYFC', // [82, 80, 83, 71, 76, 68, 84, 89, 70, 67]
          NUM_9: 'EJLUIMTXPC', // [69, 74, 76, 85, 73, 77, 84, 88, 80, 67]
          NUM_10: 'KECDNBFAXM', // [75, 69, 67, 68, 78, 66, 70, 65, 88, 77]
        },
      },
      PUBLIC_CARD_STRS: {
        k: 'QGAMLYWOKB', // [81, 71, 65, 77, 76, 89, 87, 79, 75, 66]
        v: obfuscatedStr(),
      },
      /* COIN_NUMS: {
        k: 'OQTDZWUGXS', // [79, 81, 84, 68, 90, 87, 85, 71, 88, 83]
        v: {
          NUM_11: 'RNQUKJXEFZ', // [82, 78, 81, 85, 75, 74, 88, 69, 70, 90]
          NUM_12: 'KWURNSMYFZ', // [75, 87, 85, 82, 78, 83, 77, 89, 70, 90]
          NUM_13: 'KBIGNZLWEM', // [75, 66, 73, 71, 78, 90, 76, 87, 69, 77]
          NUM_14: 'JYAPSNDIVQ', // [74, 89, 65, 80, 83, 78, 68, 73, 86, 81]
          NUM_15: 'VRTAWBOLFG', // [86, 82, 84, 65, 87, 66, 79, 76, 70, 71]
          NUM_16: 'UKAPGQHWRM', // [85, 75, 65, 80, 71, 81, 72, 87, 82, 77]
          NUM_17: 'ULDXJFISPY', // [85, 76, 68, 88, 74, 70, 73, 83, 80, 89]
          NUM_18: 'INTCJAOBWU', // [73, 78, 84, 67, 74, 65, 79, 66, 87, 85]
          NUM_19: 'JGKPODVSAX', // [74, 71, 75, 80, 79, 68, 86, 83, 65, 88]
          NUM_20: 'BUNOZTWXCD', // [66, 85, 78, 79, 90, 84, 87, 88, 67, 68]
          NUM_21: 'FLTZDJVERS', // [70, 76, 84, 90, 68, 74, 86, 69, 82, 83]
          NUM_22: 'HAXNUOZJRW', // [72, 65, 88, 78, 85, 79, 90, 74, 82, 87]
          NUM_23: 'JUGFAMVNWC', // [74, 85, 71, 70, 65, 77, 86, 78, 87, 67]
          NUM_24: 'VZHJXMKLSP', // [86, 90, 72, 74, 88, 77, 75, 76, 83, 80]
          NUM_25: 'VXYZRBSWAQ', // [86, 88, 89, 90, 82, 66, 83, 87, 65, 81]
          NUM_26: 'CNGSVHBDOM', // [67, 78, 71, 83, 86, 72, 66, 68, 79, 77]
          NUM_27: 'ERCVUDPJLI', // [69, 82, 67, 86, 85, 68, 80, 74, 76, 73]
          NUM_28: 'UOIHZNSPFE', // [85, 79, 73, 72, 90, 78, 83, 80, 70, 69]
          NUM_29: 'WTPZVXIACN', // [87, 84, 80, 90, 86, 88, 73, 65, 67, 78]
          NUM_30: 'OLRUNSVJDZ', // [79, 76, 82, 85, 78, 83, 86, 74, 68, 90]
          NUM_31: 'WVSKTDXOIG', // [87, 86, 83, 75, 84, 68, 88, 79, 73, 71]
          NUM_32: 'DVTCUYRZEA', // [68, 86, 84, 67, 85, 89, 82, 90, 69, 65]
          NUM_33: 'ILDKMRHGPJ', // [73, 76, 68, 75, 77, 82, 72, 71, 80, 74]
          NUM_34: 'RBVFOQDTHI', // [82, 66, 86, 70, 79, 81, 68, 84, 72, 73]
          NUM_35: 'TFKSBLZRUH', // [84, 70, 75, 83, 66, 76, 90, 82, 85, 72]
          NUM_36: 'EQNGDAVYUM', // [69, 81, 78, 71, 68, 65, 86, 89, 85, 77]
          NUM_37: 'XBNIGLWRHO', // [88, 66, 78, 73, 71, 76, 87, 82, 72, 79]
          NUM_38: 'TIGNFOXYLH', // [84, 73, 71, 78, 70, 79, 88, 89, 76, 72]
          NUM_39: 'OMKHFTNCLG', // [79, 77, 75, 72, 70, 84, 78, 67, 76, 71]
          NUM_40: 'ZSIKJDPFTO', // [90, 83, 73, 75, 74, 68, 80, 70, 84, 79]
        },
      }, */
      /*
      GAME_STATE_ALL_KEYS: {
        k: 'XBAHZDVKUI', // [88, 66, 65, 72, 90, 68, 86, 75, 85, 73]
      },
      GAME_NAME: {
        k: 'BVDIEAIBKE', // [66, 86, 68, 73, 69, 65, 73, 66, 75, 69]
        v: 'DJEMFKLVDE', // indianPocker -> [68, 74, 69, 77, 70, 75, 76, 86, 68, 69]
      },
      ROOM_NAME: {
        k: 'JVXNPFUHWD', // [74, 86, 88, 78, 80, 70, 85, 72, 87, 68]
      },
      REMOTE_PLAYER: {
        k: 'JSNYCGWFRV', // [74, 83, 78, 89, 67, 71, 87, 70, 82, 86]
      },
      CARD_NUM: {
        k: 'MDOXIVEFAP', // [80, 76, 72, 71, 86, 73, 69, 66, 78, 81]
      },
      GAME_STATE: {
        k: 'IKVUDKLWOD', // [77, 73, 75, 86, 85, 68, 75, 76, 87, 79, 68]
        v: {
          waitEnemy: 'JKGZWOUEAX', // [74, 75, 71, 90, 87, 79, 85, 69, 65, 88]
          choiceCard: 'WJAPYUZTHR', // [87, 74, 65, 80, 89, 85, 90, 84, 72, 82]
          basicBet: 'FHVXRBKYOD', // [70, 72, 86, 88, 82, 66, 75, 89, 79, 68]
          playing: 'TXVBNIRQWG', // [84, 88, 86, 66, 78, 73, 82, 81, 87, 71]
          gameOver: 'AFOILUXWVK', // [65, 70, 79, 73, 76, 85, 88, 87, 86, 75]
        },
      },
      */

      /**
       * choice card
       */
      /*
      // s: sessionStorage keys
      PLAYER_FIRST_CARD_NUM: {
        k: 'MDIZJHVGUW', // [77, 68, 73, 90, 74, 72, 86, 71, 85, 87]
      },
      UL_INDEX: {
        k: 'NIDLCRWSYF', // [78, 73, 68, 76, 67, 82, 87, 83, 89, 70]
      },
      LI_INDEX: {
        k: 'SFOCAGBWMV', // [83, 70, 79, 67, 65, 71, 66, 87, 77, 86]
      },
      ENEMY_FIRST_NUMBER: {
        k: 'QCRJWLYOSU', // [81, 67, 82, 74, 87, 76, 89, 79, 83, 85]
      },
      UL_INDEX_ENEMY: {
        k: 'NHYICUGOML', // [78, 72, 89, 73, 67, 85, 71, 79, 77, 76]
      },
      LI_INDEX_ENEMY: {
        k: 'MCEIHKDRGP', // [77, 67, 69, 73, 72, 75, 68, 82, 71, 80]
      },
      ENEMY_CARD_CHOICE_READY: { // true/false
        k: 'DGWMUBATXE', // [68, 71, 87, 77, 85, 66, 65, 84, 88, 69]
      },
      BET_USER: { // true/false/''
        k: 'HFUCSDYRMX', // [72, 70, 85, 67, 83, 68, 89, 82, 77, 88]
      },
      BET_USER_FIRST: { // true/false/''
        k: 'ZYPFDTAMJN', // [90, 89, 80, 70, 68, 84, 65, 77, 74, 78]
      },
      MY_NEXT_STEP_STATE: { // true/false
        k: 'RICMUXFSGW', // [82, 73, 67, 77, 85, 88, 70, 83, 71, 87]
      },
      NEXT_STEP_CHOICE_CARD: { // true/false
        k: 'DOJURSQVHM', // [68, 79, 74, 85, 82, 83, 81, 86, 72, 77]
      },
      TIE_WAIT: { // true/false
        k: 'OXMTWVSEYI', // [79, 88, 77, 84, 87, 86, 83, 69, 89, 73]
      },
      // e: sessionStorage keys

      /**
       * basic bet
       */
      /*
      // s: sessionStorage keys
      BET_STATE: {
        k: 'FMPXWVSYKA', // [70, 77, 80, 88, 87, 86, 83, 89, 75, 65]
        v: {
          basicBetting: 'FTKWJCIMPA', // [70, 84, 75, 87, 74, 67, 73, 77, 80, 65]
          extraBetting: 'MVSWEIHXPY', // [77, 86, 83, 87, 69, 73, 72, 88, 80, 89]
        },
      },
      ROUND_END: { // true/false
        k: 'SNVODIGWRU', // [83, 78, 86, 79, 68, 73, 71, 87, 82, 85]
      },
      BASIC_BET_READY: { // true/false
        k: 'HQIOSFNPKX', // [72, 81, 73, 79, 83, 70, 78, 80, 75, 88]
      },
      EXT_FIRST_BET: { // true/false
        k: 'MLCXOWSZYV', // [77, 76, 67, 88, 79, 87, 83, 90, 89, 86]
      },
      BET_USER: { // true/false/''
        k: 'HFUCSDYRMX', // [72, 70, 85, 67, 83, 68, 89, 82, 77, 88]
      },
      BET_USER_FIRST: { // true/false/''
        k: 'ZYPFDTAMJN', // [90, 89, 80, 70, 68, 84, 65, 77, 74, 78]
      },
      COINS_PLAYER: {
        k: 'QCEDGMSZAJ', // [81, 67, 69, 68, 71, 77, 83, 90, 65, 74]
      },
      COINS_PLAYER_BET: {
        k: 'XOVJHPGFEM', // [88, 79, 86, 74, 72, 80, 71, 70, 69, 77]
      },
      COINS_PLAYER_EXT_BET: {
        k: 'FZOCXMERTQ' //  [70, 90, 79, 67, 88, 77, 69, 82, 84, 81]
      },
      COINS_ENEMY: {
        k: 'SNTDBPGACW', // [83, 78, 84, 68, 66, 80, 71, 65, 67, 87]
      },
      COINS_ENEMY_BET: {
        k: 'COBFKRJXED', // [67, 79, 66, 70, 75, 82, 74, 88, 69, 68]
      },
      COINS_ENEMY_EXT_BET: {
        k: 'PIDAZEXVRC' //  [80, 73, 68, 65, 90, 69, 88, 86, 82, 67]
      },
      DREW_READY: { // true/false
        k: 'RCFEDVXJSN', // [82, 67, 70, 69, 68, 86, 88, 74, 83, 78]
      },
      BASIC_BETTING_STATE: { // true/false
        k: 'QEMHKCIWOJ', // [81, 69, 77, 72, 75, 67, 73, 87, 79, 74]
      },
      DREW_STATE: { // true/false
        k: 'CGODLITJPM' // [67, 71, 79, 68, 76, 73, 84, 74, 80, 77]
      },
      RESULT: { // true/false
        k: 'OUMJGNPCQH' // [79, 85, 77, 74, 71, 78, 80, 67, 81, 72]
      }
      DROP_STATE: { // true/false
        k: 'QEGTUZRCMY' // [81, 69, 71, 84, 85, 90, 82, 67, 77, 89]
      },
      COINS_ENEMY_LOCAL_FOLD: {
        k: 'VZQMJHXSAP' // [86, 90, 81, 77, 74, 72, 88, 83, 65, 80]
      },
      COINS_PLAYER_LOCAL_FOLD: {
        k: 'PNAJRFBCQE' // [80, 78, 65, 74, 82, 70, 66, 67, 81, 69]
      },
      COINS_ENEMY_REMOTE_FOLD: {
        k: 'OZJGNYERXT' // [79, 90, 74, 71, 78, 89, 69, 82, 88, 84]
      },
      COINS_PLAYER_REMOTE_FOLD: {
        k: 'WDMXVZKOJR' // [87, 68, 77, 88, 86, 90, 75, 79, 74, 82]
      },
      FOLD_USER: {
        k: 'BAQLTGCVRS' // [66, 65, 81, 76, 84, 71, 67, 86, 82, 83]
      },
      FOLD_STATE: {
        k: 'AHBKUEWOXV' // [65, 72, 66, 75, 85, 69, 87, 79, 88, 86]
      },
      BATTLE_CARD_NUM: {
        k: 'IKHAMRUPBW' // [73, 75, 72, 65, 77, 82, 85, 80, 66, 87]
      },
      PLAYER_CARD_NUM: {
        k: 'MWUXSPOZAB' // [77, 87, 85, 88, 83, 80, 79, 90, 65, 66]
      },
      PLAYING_RELOAD_USER: {
        k: 'KQSPYXVHRM' // [75, 81, 83, 80, 89, 88, 86, 72, 82, 77]
      },
      BET_COIN: { : TODO:
        k: 'DUHITAZFYX', // [68, 85, 72, 73, 84, 65, 90, 70, 89, 88]
        v: {
          betState: {
            k: '',
            v: {
              end: '',
            }
          },
          host: {
            k: '',
            v: {
              'pleyer': ''
              'enemy': ''
            }
          },
          index: ',
          translateX: '',
          translateY: '',
          offsetLeft: '',
          offsetTop: '',
          tm: '',
          th: '',
        }
      },
      BET_COIN_POS: { : TODO:
        k: 'DEKHCVZPAO', // [68, 69, 75, 72, 67, 86, 90, 80, 65, 79]
          v: {
            host: '',
            translateX: '',
            translateY: '',
          },
        },
      },
      // e: sessionStorage keys
      // s: click event
      // choiceCardClick
      CHOICE_CARD_CLICK: {
        k: 'FHOEWPICTS', // [70, 72, 79, 69, 87, 80, 73, 67, 84, 83]
      },
      RESULT_BETTING_CLICK: {
        k: 'BHINYATMSV', // [66, 72, 73, 78, 89, 65, 84, 77, 83, 86]
      },
      // e: click event
      */

      /**
       * playing
       */
      /*
      // s: sessionStorage keys
      BET_STATE: {
        k: 'FMPXWVSYKA', // [70, 77, 80, 88, 87, 86, 83, 89, 75, 65]
        v: {
          basicBetting: 'FTKWJCIMPA', // [70, 84, 75, 87, 74, 67, 73, 77, 80, 65]
          extraBetting: 'MVSWEIHXPY', // [77, 86, 83, 87, 69, 73, 72, 88, 80, 89]
        },
      },
      ROUND_END: { // true/false
        k: 'SNVODIGWRU', // [83, 78, 86, 79, 68, 73, 71, 87, 82, 85]
      },
      BASIC_BET_READY: { // true/false
        k: 'HQIOSFNPKX', // [72, 81, 73, 79, 83, 70, 78, 80, 75, 88]
      },
      EXT_FIRST_BET: { // true/false
        k: 'MLCXOWSZYV', // [77, 76, 67, 88, 79, 87, 83, 90, 89, 86]
      },
      BET_USER: { // true/false/''
        k: 'HFUCSDYRMX', // [72, 70, 85, 67, 83, 68, 89, 82, 77, 88]
      },
      BET_USER_FIRST: { // true/false/''
        k: 'ZYPFDTAMJN', // [90, 89, 80, 70, 68, 84, 65, 77, 74, 78]
      },
      COINS_PLAYER: {
        k: 'QCEDGMSZAJ', // [81, 67, 69, 68, 71, 77, 83, 90, 65, 74]
      },
      COINS_PLAYER_BET: {
        k: 'XOVJHPGFEM', // [88, 79, 86, 74, 72, 80, 71, 70, 69, 77]
      },
      COINS_PLAYER_EXT_BET: {
        k: 'FZOCXMERTQ' //  [70, 90, 79, 67, 88, 77, 69, 82, 84, 81]
      },
      COINS_ENEMY: {
        k: 'SNTDBPGACW', // [83, 78, 84, 68, 66, 80, 71, 65, 67, 87]
      },
      COINS_ENEMY_BET: {
        k: 'COBFKRJXED', // [67, 79, 66, 70, 75, 82, 74, 88, 69, 68]
      },
      COINS_ENEMY_EXT_BET: {
        k: 'PIDAZEXVRC' //  [80, 73, 68, 65, 90, 69, 88, 86, 82, 67]
      },
      DREW_READY: { // true/false
        k: 'RCFEDVXJSN', // [82, 67, 70, 69, 68, 86, 88, 74, 83, 78]
      },
      BASIC_BETTING_STATE: { // true/false
        k: 'QEMHKCIWOJ', // [81, 69, 77, 72, 75, 67, 73, 87, 79, 74]
      },
      DREW_STATE: { // true/false
        k: 'CGODLITJPM' // [67, 71, 79, 68, 76, 73, 84, 74, 80, 77]
      },
      RESULT: { // true/false
        k: 'OUMJGNPCQH' // [79, 85, 77, 74, 71, 78, 80, 67, 81, 72]
      }
      DROP_STATE: { // true/false
        k: 'QEGTUZRCMY' // [81, 69, 71, 84, 85, 90, 82, 67, 77, 89]
      },
      COINS_ENEMY_LOCAL_FOLD: {
        k: 'VZQMJHXSAP' // [86, 90, 81, 77, 74, 72, 88, 83, 65, 80]
      },
      COINS_PLAYER_LOCAL_FOLD: {
        k: 'PNAJRFBCQE' // [80, 78, 65, 74, 82, 70, 66, 67, 81, 69]
      },
      COINS_ENEMY_REMOTE_FOLD: {
        k: 'OZJGNYERXT' // [79, 90, 74, 71, 78, 89, 69, 82, 88, 84]
      },
      COINS_PLAYER_REMOTE_FOLD: {
        k: 'WDMXVZKOJR' // [87, 68, 77, 88, 86, 90, 75, 79, 74, 82]
      },
      FOLD_USER: {
        k: 'BAQLTGCVRS' // [66, 65, 81, 76, 84, 71, 67, 86, 82, 83]
      },
      FOLD_STATE: {
        k: 'AHBKUEWOXV' // [65, 72, 66, 75, 85, 69, 87, 79, 88, 86]
      },
      BATTLE_CARD_NUM: {
        k: 'IKHAMRUPBW' // [73, 75, 72, 65, 77, 82, 85, 80, 66, 87]
      },
      PLAYER_CARD_NUM: {
        k: 'MWUXSPOZAB' // [77, 87, 85, 88, 83, 80, 79, 90, 65, 66]
      },
      PLAYING_RELOAD_USER: {
        k: 'KQSPYXVHRM' // [75, 81, 83, 80, 89, 88, 86, 72, 82, 77]
      },
      BET_COIN: {
        k: 'DUHITAZFYX', // [68, 85, 72, 73, 84, 65, 90, 70, 89, 88]
        v: {
          betState: {
            k: 'PHSXLKNTAY', // [80, 72, 83, 88, 76, 75, 78, 84, 65, 89]
            v: {
              end: 'KBWQGMYSUE', // [75, 66, 87, 81, 71, 77, 89, 83, 85, 69]
            }
          },
          host: {
            k: 'XOHKGSQURT', // [88, 79, 72, 75, 71, 83, 81, 85, 82, 84]
            v: {
              'pleyer': 'WDXFUYIGVT' // [87, 68, 88, 70, 85, 89, 73, 71, 86, 84]
              'enemy': 'KEMUTIOBNV' // [75, 69, 77, 85, 84, 73, 79, 66, 78, 86]
            }
          },
          index: 'MKWFRXSJYP', // [77, 75, 87, 70, 82, 88, 83, 74, 89, 80]
          translateX: 'QPJVGMEZIO', // [81, 80, 74, 86, 71, 77, 69, 90, 73, 79]
          translateY: 'LPARWENJSZ', // [76, 80, 65, 82, 87, 69, 78, 74, 83, 90]
          offsetLeft: 'CEROSXMTPK', // [67, 69, 82, 79, 83, 88, 77, 84, 80, 75]
          offsetTop: 'UTYKGQEAHS', // [85, 84, 89, 75, 71, 81, 69, 65, 72, 83]
          tm: 'FVGWETUYJB', // [70, 86, 71, 87, 69, 84, 85, 89, 74, 66]
          th: 'SLEBKQTIZA', // [83, 76, 69, 66, 75, 81, 84, 73, 90, 65]
        }
      },
      BET_COIN_POS: {
        k: 'DEKHCVZPAO', // [68, 69, 75, 72, 67, 86, 90, 80, 65, 79]
          v: {
            host: {
              k: 'BUWJOZVSHX', // [66, 85, 87, 74, 79, 90, 86, 83, 72, 88]
              v: {
                'pleyer': 'IWVRUTODZB' // [73, 87, 86, 82, 85, 84, 79, 68, 90, 66]
                'enemy': 'YDVETBMWAZ' // [89, 68, 86, 69, 84, 66, 77, 87, 65, 90]
              }
            },
            translateX: 'UKHEGBJQWT', // [85, 75, 72, 69, 71, 66, 74, 81, 87, 84]
            translateY: 'PCZURGFBTJ', // [80, 67, 90, 85, 82, 71, 70, 66, 84, 74]
          },
        },
      },
      // choice card 이후 playing에서 추가된 key 들
      BET_RESULTING: {
        k: 'ARITSWJCYZ' // [65, 82, 73, 84, 83, 87, 74, 67, 89, 90]
      },
      DREW_FLIP_CARD_MODE: {
        k: 'OLXTKAMIHV' // [79, 76, 88, 84, 75, 65, 77, 73, 72, 86]
      },
      DREW_CARD_READY: {
        k: 'ZMGTADWQFR' // [90, 77, 71, 84, 65, 68, 87, 81, 70, 82]
      },
      // e: sessionStorage keys
      */
    };
  },
  blackAndWhite1: () => {
    return {
      /*
      GAME_NAME: {
        k: 'OKHPUWZYVA', // [79, 75, 72, 80, 85, 87, 90, 89, 86, 65]
        v: 'EBMVIZGNYO', // blackAndWhite1 -> [69, 66, 77, 86, 73, 90, 71, 78, 89, 79]
      },
      GAME_STATE: {
        k: 'YOEGRSWKVU', // [89, 79, 69, 71, 82, 83, 87, 75, 86, 85]
        v: {
          waitEnemy: 'BQNXJPFAZG', // [66, 81, 78, 88, 74, 80, 70, 65, 90, 71]
          ready: 'HLJSOMTIEA', // [72, 76, 74, 83, 79, 77, 84, 73, 69, 65]
          waitEnemyShuffle: 'CVPELBMIHG', // [67, 86, 80, 69, 76, 66, 77, 73, 72, 71]
          setOrder: 'AGQHUKNJVI', // [65, 71, 81, 72, 85, 75, 78, 74, 86, 73]
          playing: 'KDCGRWJIBN', // [75, 68, 67, 71, 82, 87, 74, 73, 66, 78]
          gameOver: 'CDHEZMPQKU', // [67, 68, 72, 69, 90, 77, 80, 81, 75, 85]
        },
      },
      GAME_STATE_ALL_KEYS: {
        k: 'IFACVBSYZP', // [73, 70, 65, 67, 86, 66, 83, 89, 90, 80]
      },
      CUBE_COLOR_CODE: {
        k: 'MRKTOHQFZS', // [77, 82, 75, 84, 79, 72, 81, 70, 90, 83]
        v: {
          EVEN_0: 'YIETCAHGPJ', // [89, 73, 69, 84, 67, 65, 72, 71, 80, 74]
          EVEN_1: 'VWJUPKSMAC', // [86, 87, 74, 85, 80, 75, 83, 77, 65, 67]
          EVEN_2: 'IWGPKYZBQA', // [73, 87, 71, 80, 75, 89, 90, 66, 81, 65]
          EVEN_3: 'KRIVZFTUXW', // [75, 82, 73, 86, 90, 70, 84, 85, 88, 87]
          EVEN_4: 'GFOSCEZYVM', // [71, 70, 79, 83, 67, 69, 90, 89, 86, 77]
          EVEN_5: 'YMUPQFABXE', // [89, 77, 85, 80, 81, 70, 65, 66, 88, 69]
          EVEN_6: 'KMIYGJCBFP', // [75, 77, 73, 89, 71, 74, 67, 66, 70, 80]
          EVEN_7: 'SADCIETBYK', // [83, 65, 68, 67, 73, 69, 84, 66, 89, 75]
          EVEN_8: 'CWYZSHGIXK', // [67, 87, 89, 90, 83, 72, 71, 73, 88, 75]
          ODD_0: 'RSIVXMJYNB', // [82, 83, 73, 86, 88, 77, 74, 89, 78, 66]
          ODD_1: 'IGDXSEJNHF', // [73, 71, 68, 88, 83, 69, 74, 78, 72, 70]
          ODD_2: 'SCHYBKGENX', // [83, 67, 72, 89, 66, 75, 71, 69, 78, 88]
          ODD_3: 'WBPEIXSYCA', // [87, 66, 80, 69, 73, 88, 83, 89, 67, 65]
          ODD_4: 'VMHYIXEPDG', // [86, 77, 72, 89, 73, 88, 69, 80, 68, 71]
          ODD_5: 'CYGSNJKQFU', // [67, 89, 71, 83, 78, 74, 75, 81, 70, 85]
          ODD_6: 'SVULOJHIQT', // [83, 86, 85, 76, 79, 74, 72, 73, 81, 84]
          ODD_7: 'ZNOPABQKIU', // [90, 78, 79, 80, 65, 66, 81, 75, 73, 85]
          ODD_8: 'XWKEIJYQMB', // [88, 87, 75, 69, 73, 74, 89, 81, 77, 66]
        }
      },
      CUBE_NUMS: {
        k: 'NUDSYJETWV', // [78, 85, 68, 83, 89, 74, 69, 84, 87, 86]
        v: [
          {
            NUM_0: "GUDZFMLOYW", // [71, 85, 68, 90, 70, 77, 76, 79, 89, 87]
            NUM_1: "SRCWHDMAFB", // [83, 82, 67, 87, 72, 68, 77, 65, 70, 66]
            NUM_2: "WPGMLTCJES", // [87, 80, 71, 77, 76, 84, 67, 74, 69, 83]
            NUM_3: "BCIYEHLOUK", // [66, 67, 73, 89, 69, 72, 76, 79, 85, 75]
            NUM_4: "VBHPGIKDOC", // [86, 66, 72, 80, 71, 73, 75, 68, 79, 67]
            NUM_5: "GDXRFLEMOZ", // [71, 68, 88, 82, 70, 76, 69, 77, 79, 90]
            NUM_6: "IKEMGNWLHT", // [73, 75, 69, 77, 71, 78, 87, 76, 72, 84]
            NUM_7: "NVTRKJMXZO", // [78, 86, 84, 82, 75, 74, 77, 88, 90, 79]
            NUM_8: "BITNZKPHAO", // [66, 73, 84, 78, 90, 75, 80, 72, 65, 79]
          },
          {
            NUM_0: "MHVYPUTNJG", // [77, 72, 86, 89, 80, 85, 84, 78, 74, 71]
            NUM_1: "AGOQIBLHUM", // [65, 71, 79, 81, 73, 66, 76, 72, 85, 77]
            NUM_2: "AEXSJCYKUO", // [65, 69, 88, 83, 74, 67, 89, 75, 85, 79]
            NUM_3: "TSFGLKDBEY", // [84, 83, 70, 71, 76, 75, 68, 66, 69, 89]
            NUM_4: "GSUDKTZXEB", // [71, 83, 85, 68, 75, 84, 90, 88, 69, 66]
            NUM_5: "MVRIKFQLGX", // [77, 86, 82, 73, 75, 70, 81, 76, 71, 88]
            NUM_6: "GJBDKEWFRY", // [71, 74, 66, 68, 75, 69, 87, 70, 82, 89]
            NUM_7: "MNUSDRTAHO", // [77, 78, 85, 83, 68, 82, 84, 65, 72, 79]
            NUM_8: "KMHXCERUNP", // [75, 77, 72, 88, 67, 69, 82, 85, 78, 80]
          },
          {
            NUM_0: "ZLNEVHSWTD", // [90, 76, 78, 69, 86, 72, 83, 87, 84, 68]
            NUM_1: "SRJGOPFHQU", // [83, 82, 74, 71, 79, 80, 70, 72, 81, 85]
            NUM_2: "YNCPWJIUGS", // [89, 78, 67, 80, 87, 74, 73, 85, 71, 83]
            NUM_3: "EJPUMBFSKY", // [69, 74, 80, 85, 77, 66, 70, 83, 75, 89]
            NUM_4: "QBPWYMULCZ", // [81, 66, 80, 87, 89, 77, 85, 76, 67, 90]
            NUM_5: "QTDVIBNRCP", // [81, 84, 68, 86, 73, 66, 78, 82, 67, 80]
            NUM_6: "BYPKFHLJQD", // [66, 89, 80, 75, 70, 72, 76, 74, 81, 68]
            NUM_7: "SQZJVHMOGF", // [83, 81, 90, 74, 86, 72, 77, 79, 71, 70]
            NUM_8: "FZBYGQPSHA", // [70, 90, 66, 89, 71, 81, 80, 83, 72, 65]
          },
          {
            NUM_0: "LMSGJNAQBX", // [76, 77, 83, 71, 74, 78, 65, 81, 66, 88]
            NUM_1: "YFWEKTSXLM", // [89, 70, 87, 69, 75, 84, 83, 88, 76, 77]
            NUM_2: "SGQVDLBNWF", // [83, 71, 81, 86, 68, 76, 66, 78, 87, 70]
            NUM_3: "YFZACHTVSX", // [89, 70, 90, 65, 67, 72, 84, 86, 83, 88]
            NUM_4: "CHEIFVWGAY", // [67, 72, 69, 73, 70, 86, 87, 71, 65, 89]
            NUM_5: "VLTPNFZAHD", // [86, 76, 84, 80, 78, 70, 90, 65, 72, 68]
            NUM_6: "KHPFJQUDYB", // [75, 72, 80, 70, 74, 81, 85, 68, 89, 66]
            NUM_7: "CFMUIZPOEG", // [67, 70, 77, 85, 73, 90, 80, 79, 69, 71]
            NUM_8: "CYGMVLNEKT", // [67, 89, 71, 77, 86, 76, 78, 69, 75, 84]
          },
        ]
      },
      CUBE_NUMS_PUBLIC: {
        k: 'NIOKCZWBDX', // [78, 73, 79, 75, 67, 90, 87, 66, 68, 88]
        v: {
          NUM_0: "NKOYAJSITL", // [78, 75, 79, 89, 65, 74, 83, 73, 84, 76]
          NUM_1: "WYFXLZCAGJ", // [87, 89, 70, 88, 76, 90, 67, 65, 71, 74]
          NUM_2: "KDJBIMLXGY", // [75, 68, 74, 66, 73, 77, 76, 88, 71, 89]
          NUM_3: "YUZESNJPVK", // [89, 85, 90, 69, 83, 78, 74, 80, 86, 75]
          NUM_4: "CNRQBHYUIG", // [67, 78, 82, 81, 66, 72, 89, 85, 73, 71]
          NUM_5: "FRJGCILMXW", // [70, 82, 74, 71, 67, 73, 76, 77, 88, 87]
          NUM_6: "AMLUSPKEDN", // [65, 77, 76, 85, 83, 80, 75, 69, 68, 78]
          NUM_7: "YTQBJFEKOR", // [89, 84, 81, 66, 74, 70, 69, 75, 79, 82]
          NUM_8: "ADVPQLJYUH", // [65, 68, 86, 80, 81, 76, 74, 89, 85, 72]
        }
      },
      /**
       * ready
       */
      /*
      // s: sessionStorage keys
      MY_SHUFFLE_STATE: {
        k: 'PHIJYVSBEW' // [80, 72, 73, 74, 89, 86, 83, 66, 69, 87]
      },
      ENEMY_SHUFFLE_STATE: {
        k: 'BOSAYQJDWF' // [66, 79, 83, 65, 89, 81, 74, 68, 87, 70]
      },
      ROUND: {
        k: 'MTSXEURWZO' // [77, 84, 83, 88, 69, 85, 82, 87, 90, 79]
      },
      NUM_ARR: {
        k: 'OMEXDYAFCN' // [79, 77, 69, 88, 68, 89, 65, 70, 67, 78]
      },
      PLAYER_NUM_ORDER: {
        k: 'UVDJEMYPBK' // [85, 86, 68, 74, 69, 77, 89, 80, 66, 75]
      },
      ENEMY_CUBE: {
        k: 'VRXYZHGTJU' // [86, 82, 88, 89, 90, 72, 71, 84, 74, 85]
      },
      // e: sessionStorage keys
      */

      /**
       * setOrder
       */
      /*
      // s: sessionStorage keys
      FIRST_USER: {
        k: 'IQZSDVEYNF' // [73, 81, 90, 83, 68, 86, 69, 89, 78, 70]
      },
      ENEMY_NICK: {
        k: 'MJCHADPUTZ' // [77, 74, 67, 72, 65, 68, 80, 85, 84, 90]
      },
      ACTIVE_USER: {
        k: 'IGAPMKTBUR' // [73, 71, 65, 80, 77, 75, 84, 66, 85, 82]
      },
      // e: sessionStorage keys
      */

      /**
       * playing
       */
      /*
      // s: sessionStorage keys
      USER_ORDER: {
        k: 'JAXHBTSCEU' // [74, 65, 88, 72, 66, 84, 83, 67, 69, 85]
      },
      RESULT: {
        k: 'GIEMSNYXRB' // [71, 73, 69, 77, 83, 78, 89, 88, 82, 66]
      },
      BEFORE_PLAYER_NUM: {
        k: 'AEDORUNPZK' // [65, 69, 68, 79, 82, 85, 78, 80, 90, 75]
      },
      // e: sessionStorage keys
      */
    };
  },
};

/**
// 문자열을 배열로 변환
const str = "BVDIEAIBKE";
const charCodes = Array.from(str).map(char => char.charCodeAt(0)); // 방법 1
console.log(charCodes);
const arr = [..."BVDIEAIBKE"].map(c => c.charCodeAt(0)); // 방법 2
console.log(arr);

// 배열을 문자열로 변환
String.fromCharCode(...[66, 86, 68, 73, 69, 65, 73, 66, 75, 69]); // "BVDIEAIBKE"
*/

/*
// 겹치지 않는 10개의 랜덤 영문 대문자를 리턴하는 JavaScript 함수
function getRandomUniqueLetters() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letters = alphabet.split('');

  // 결과를 담을 배열
  const result = [];

  while (result.length < 10) {
    // 랜덤한 인덱스 선택
    const index = Math.floor(Math.random() * letters.length);

    // 해당 알파벳을 결과에 추가
    result.push(letters[index]);

    // 중복 방지를 위해 선택한 알파벳 제거
    letters.splice(index, 1);
  }
  return result.join('');
}
getRandomUniqueLetters();

// 40번 반복
for (let i = 0; i < 40; i++) {
  console.log(i, ' : ', getRandomUniqueLetters());
}
*/

/*
const K = [
  '',
];
const V = K.map((k) => {
  return {
    k: k,
    v: [...k].map(c => c.charCodeAt(0))
  }
})
*/
